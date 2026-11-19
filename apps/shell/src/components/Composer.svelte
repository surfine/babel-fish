<script lang="ts">
  import { aiErrText } from '../lib/translate/errors';
  import { shouldClearComposer } from '../lib/guide';
  import { tick, untrack } from 'svelte';
  import { app } from '../lib/store.svelte';
  import { ICON } from '../lib/icons';
  import { compose, ui, anchorOf, type ComposerScope } from '../lib/ui.svelte';
  import { emojiChar } from '../lib/emoji';
  import { GLOSSARY, polisher, verifier, llmStatus, type PolishDraft, type PolishRequest, type Tone, type BackSegment, type MeaningCheck } from '../lib/translate';
  import { SAMPLE_DRAFT, SAMPLE_DRAFT_EN } from '../lib/demo/data';
  import { langName, regional, t, userLang } from '../lib/i18n';
  import { baseLang, detectLang } from '../lib/lang';

  let { channel, threadTs = null, scope }: { channel: string; threadTs?: string | null; scope: ComposerScope } = $props();

  const ARM_MS = 800; // 審閱卡剛出現的 0.8 秒內送出鈕不作用

  type Review = {
    loading: boolean;
    loadingLabel: string | null; // 換語氣、再調整時的單行提示
    draftAtPolish: string;
    tone: Tone;
    result: PolishDraft | null;
    split: boolean;
    applied: string | null;
    staleZh: boolean;
    staleEn: boolean;
    rechecking: boolean;
    armed: boolean;
    back: { segments: BackSegment[]; check: MeaningCheck } | null;
    gen: number; // 每次重寫 +1，讓可編輯泡泡重新渲染
  };

  // 使用者語言 U（草稿）與頻道語言 C（送出）
  const u = userLang();
  const c = $derived(app.channelLang(channel));
  const same = $derived(u === c);
  const mine = langName(u, u);
  const theirs = $derived(langName(c, u));

  // 示範模式：預先填好一段草稿（中文使用者在英文頻道、英文使用者在中文頻道）
  function demoDraft(): string {
    if (scope !== 'main' || app.source?.kind !== 'demo') return '';
    const ch = app.channelLang(channel);
    if (u !== 'en' && ch === 'en') return regional(SAMPLE_DRAFT);
    if (u === 'en' && ch !== 'en') return SAMPLE_DRAFT_EN;
    return '';
  }
  let draft = $state('');
  // 頻道訊息載入後才知道頻道語言，那時再填
  let prefilled = false;
  $effect(() => {
    if (prefilled || app.messages[channel] === undefined) return;
    prefilled = true;
    untrack(() => {
      if (!draft) draft = demoDraft();
    });
  });
  let files = $state<File[]>([]);
  let review = $state<Review | null>(null);
  let ta: HTMLTextAreaElement;
  let reviewEl = $state<HTMLElement>();
  let fileInput = $state<HTMLInputElement>();
  let refineText = $state('');
  let armTimer: ReturnType<typeof setTimeout> | null = null;

  const replyTo = $derived(compose.replyTo[scope]);
  const label = $derived(app.convLabel(channel));
  const where = $derived(threadTs ? t('{name} 的對話串', { name: label }) : label);
  $effect(() => {
    if (compose.focus[scope]) ta?.focus();
  });
  $effect(() => {
    void draft;
    autosize();
  });

  function autosize() {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
  }

  function request(tone: Tone): PolishRequest {
    const source = threadTs ? app.threadMessages : (app.messages[channel] ?? []);
    const all = app.messages[channel] ?? [];
    return {
      draft: review?.draftAtPolish ?? draft.trim(),
      userLang: u,
      channelLang: c,
      channel: label,
      recent: source.slice(-20).map((m) => ({ author: app.name(m.user), text: app.plain(m.text) })),
      replyTo: replyTo ? { author: replyTo.author, text: replyTo.text } : null,
      tone,
      glossary: GLOSSARY,
      sample: all
        .filter((m) => m.user && m.user !== app.self?.id && !m.subtype)
        .slice(-200)
        .map((m) => ({ author: app.name(m.user), text: app.plain(m.text), ts: Number(m.ts) })),
      // 自己過去在這個頻道用頻道語言寫的訊息
      myVoice: all
        .filter((m) => m.user === app.self?.id && !m.subtype && detectLang(app.plain(m.text)) === baseLang(c))
        .slice(-50)
        .map((m) => app.plain(m.text)),
    };
  }

  const parts = (r: Review) => (r.result ? (r.result.merged && !r.split ? [r.result.merged] : r.result.messages) : []);

  function arm() {
    if (!review) return;
    review.armed = false;
    if (armTimer) clearTimeout(armTimer);
    armTimer = setTimeout(() => review && (review.armed = true), ARM_MS);
  }

  async function verify(texts: string[]) {
    if (!review) return;
    const r = review;
    const back = await verifier.backTranslate(texts, c, u);
    r.back = await verifier.compare(r.draftAtPolish, back, texts, u);
  }

  async function polish() {
    const text = draft.trim();
    if (!text) {
      if (files.length && !app.readOnly) return sendFilesOnly();
      ta.focus();
      app.toast(t('先用{lang}寫點什麼', { lang: mine }));
      return;
    }
    review = {
      loading: true, loadingLabel: null, draftAtPolish: text, tone: 'natural', result: null, split: true,
      applied: null, staleZh: false, staleEn: false, rechecking: false, armed: false, back: null, gen: 0,
    };
    const r = review;
    try {
      r.result = await polisher.polish(request('natural'));
      await verify(parts(r));
    } catch (e) {
      app.toast(t('潤色沒有完成：{error}', { error: aiErrText(e) }));
      review = null;
      return;
    }
    r.loading = false;
    arm();
    await tick();
    reviewEl?.focus({ preventScroll: true });
  }

  async function rewrite(fn: () => Promise<PolishDraft>, loadingLabel: string, patch: Partial<Review>) {
    if (!review) return;
    const r = review;
    Object.assign(r, { loading: true, loadingLabel, back: null, staleEn: false, split: true, armed: false, ...patch });
    try {
      r.result = await fn();
      await verify(parts(r));
    } catch (e) {
      app.toast(t('重寫沒有完成：{error}', { error: aiErrText(e) }));
    }
    r.loading = false;
    r.loadingLabel = null;
    r.gen++;
    arm();
  }

  function setTone(tone: Tone) {
    if (!review || (tone === review.tone && !review.applied)) return;
    rewrite(() => polisher.polish(request(tone)), t('換個語氣重寫…'), { tone, applied: null });
  }
  function refine(instruction: string) {
    const text = instruction.trim();
    if (!review?.result || !text) return;
    const prev = review.result;
    refineText = '';
    rewrite(() => polisher.refine(request(review!.tone), prev, text), t('照「{instruction}」重寫…', { instruction: text }), { applied: text });
  }
  function toggleSplit() {
    if (!review) return;
    review.split = !review.split;
    review.staleEn = false;
    review.gen++;
    arm();
    verify(parts(review));
  }
  async function recheck() {
    if (!review) return;
    review.rechecking = true;
    await verify(currentTexts());
    review.rechecking = false;
    review.staleEn = false;
  }

  function currentTexts(): string[] {
    return [...(reviewEl?.querySelectorAll<HTMLElement>('.bubble') ?? [])].map((b) => b.innerText.trim()).filter(Boolean);
  }

  function closeReview() {
    review = null;
    if (armTimer) clearTimeout(armTimer);
  }

  // 在官方 Slack 傳送了剛複製的英文：關掉審閱卡、清掉草稿，可以接著寫下一則
  $effect(() => {
    const sent = app.copySent;
    if (!sent) return;
    untrack(() => {
      if (!shouldClearComposer(sent, { channel, draft, reviewDraft: review?.draftAtPolish ?? null })) return;
      closeReview();
      if (draft.trim() === sent.draftZh.trim()) draft = '';
    });
  });

  // ---------- 唯讀模式：複製英文，到官方 Slack 貼上送出 ----------
  async function writeClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* 沒有權限或不在安全環境：退到隱藏 textarea */
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }

  // 回傳打開的網址；打不開回傳 null
  async function openSlack(): Promise<string | null> {
    if (app.source.kind !== 'tauri' || !app.team) return null;
    // Slack 文件的深層連結：slack://channel?team={TEAM_ID}&id={CHANNEL_ID}。討論串沒有公開的深層連結，只開到頻道
    const url = `slack://channel?team=${encodeURIComponent(app.team.id)}&id=${encodeURIComponent(channel)}`;
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return url;
    } catch {
      app.toast(t('已複製，但打不開 Slack。請自己切到 Slack 貼上'));
      return null;
    }
  }

  async function copyTexts(texts: string[], thenOpen: boolean) {
    const r = review;
    if (!r || r.loading) return;
    const clean = texts.map((x) => x.trim()).filter(Boolean);
    if (!clean.length) return app.toast(t('{lang}是空的', { lang: theirs }));
    if (!(await writeClipboard(clean.join('\n\n')))) return app.toast(t('沒有複製成功。請選取{lang}，按 ⌘C 複製', { lang: theirs }));
    app.rememberCopy(clean, r.draftAtPolish, channel);
    app.toast(t('已複製，到 Slack 貼上傳送'));
    if (!thenOpen) return;
    const url = await openSlack();
    if (url) await app.showPasteGuide({ channel, threadTs, texts: clean, slackUrl: url });
  }
  const copyAll = (thenOpen: boolean) => copyTexts(currentTexts(), thenOpen);
  const copyBubble = (i: number) => copyTexts(currentTexts().slice(i, i + 1), false);

  function send() {
    const r = review;
    if (!r || r.loading || !r.armed) return;
    const texts = currentTexts();
    if (!texts.length) return app.toast(t('{lang}是空的', { lang: theirs }));
    const snapshot = { review: $state.snapshot(r) as Review, texts, draft, files: [...files], replyTo };
    app.queueSend({
      channel, threadTs, texts, draft: r.draftAtPolish, files: [...files],
      onUndo: () => restore(snapshot),
    });
    closeReview();
    draft = '';
    files = [];
    compose.replyTo[scope] = null;
  }

  function sendFilesOnly() {
    const snapshot = { review: null, texts: [], draft, files: [...files], replyTo };
    app.queueSend({ channel, threadTs, texts: [], draft: '', files: [...files], onUndo: () => restore(snapshot) });
    files = [];
  }

  // 撤回：草稿、附件、審閱卡都回到送出前的樣子
  async function restore(s: { review: Review | null; texts: string[]; draft: string; files: File[]; replyTo: typeof replyTo }) {
    draft = s.draft;
    files = s.files;
    compose.replyTo[scope] = s.replyTo;
    if (!s.review) return;
    review = { ...s.review, loading: false, armed: false, gen: s.review.gen + 1 };
    arm();
    await tick();
    reviewEl?.querySelectorAll<HTMLElement>('.bubble').forEach((b, i) => {
      if (s.texts[i] != null) b.textContent = s.texts[i];
    });
  }

  function onDraftKey(e: KeyboardEvent) {
    // Enter 只換行；⌘↩ 才潤色。輸入法組字中（isComposing／keyCode 229）一律不觸發
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      polish();
    }
  }
  function onDraftInput() {
    if (review && !review.loading && !review.staleZh && draft.trim() !== review.draftAtPolish) review.staleZh = true;
  }

  function onWrapKey(e: KeyboardEvent) {
    if (e.target === ta) return;
    if (e.key === 'Escape' && review) {
      closeReview();
      ta.focus();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing && review) {
      e.preventDefault();
      if (app.readOnly) copyAll(true);
      else send();
    } else if (e.key === 'Enter' && (e.target as HTMLElement).id === `refine-${scope}` && !e.isComposing) {
      e.preventDefault();
      refine(refineText);
    }
  }

  function addFiles(list: FileList | null) {
    if (list && !app.readOnly) files = [...files, ...Array.from(list)];
    if (fileInput) fileInput.value = '';
  }
  function insertAt(text: string) {
    const s = ta.selectionStart ?? draft.length;
    const e2 = ta.selectionEnd ?? draft.length;
    draft = draft.slice(0, s) + text + draft.slice(e2);
    tick().then(() => {
      ta.focus();
      ta.setSelectionRange(s + text.length, s + text.length);
    });
  }
  function emojiPick(e: MouseEvent) {
    ui.picker = { anchor: anchorOf(e.currentTarget as Element), onPick: (n) => insertAt(emojiChar(n) ?? `:${n}:`) };
  }
  function onPaste(e: ClipboardEvent) {
    const fs = e.clipboardData?.files;
    if (fs?.length && !app.readOnly) {
      e.preventDefault();
      addFiles(fs);
    }
  }

  const TONES: [Tone, string][] = [['casual', t('更隨意')], ['natural', t('像這個頻道')], ['formal', t('更正式')]];
  const placeholder = $derived(
    same
      ? threadTs ? t('在對話串寫回覆…（⌘↩ 照頻道語氣潤色）') : t('寫回覆…（⌘↩ 照頻道語氣潤色）')
      : threadTs ? t('在對話串用{mine}回覆…（⌘↩ 潤色成{lang}）', { mine, lang: theirs }) : t('用{mine}寫回覆…（⌘↩ 潤色成{lang}）', { mine, lang: theirs }),
  );
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="composer-wrap" onkeydown={onWrapKey}>
  {#if review}
    <section class="review" tabindex="-1" aria-label={t('{lang}草稿審閱', { lang: theirs })} bind:this={reviewEl}>
      {#if review.loading && !review.result}
        <div class="steps"><div class="s run"><span class="ic"></span>{t('潤色中…')}</div></div>
      {:else if review.loading}
        <div class="steps"><div class="s run"><span class="ic"></span>{review.loadingLabel}</div></div>
      {:else if review.result}
        {@const ps = parts(review)}
        {@const n = ps.length}
        <div class="rv-head">
          <div class="rv-title">
            {t('{lang}草稿', { lang: theirs })}
            {#if review.staleZh}
              <span class="hint warn">{t('原稿改過了，')}<button class="link-btn" onclick={polish}>{t('重新潤色')}</button></span>
            {/if}
            {#if llmStatus.fake && review.draftAtPolish !== regional(SAMPLE_DRAFT) && review.draftAtPolish !== SAMPLE_DRAFT_EN}
              <span class="hint">{t('這是示範用的文字。到左下「設定」填好 AI 金鑰，才會照你的草稿改寫。')}</span>
            {/if}
          </div>
          <div class="seg seg-tone" role="tablist" aria-label={t('語氣')}>
            {#each TONES as [k, l] (k)}
              <button role="tab" aria-selected={review.tone === k && !review.applied} onclick={() => setTone(k)}>{l}</button>
            {/each}
          </div>
        </div>
        <div class="rv-body fade">
            {#key review.gen}
              {#each ps as text, i (i)}
                <div class="bubble-wrap">
                  <div
                    class="bubble"
                    contenteditable="true"
                    spellcheck="true"
                    role="textbox"
                    tabindex="0"
                    aria-label={t('第 {n} 則訊息', { n: i + 1 })}
                    oninput={() => review && (review.staleEn = true)}
                  >{text}</div>
                  {#if app.readOnly}<button class="copy-btn" aria-label={t('複製第 {n} 則訊息', { n: i + 1 })} onclick={() => copyBubble(i)}>{t('複製')}</button>{/if}
                </div>
              {/each}
            {/key}
            {#if review.result.merged}
              <button class="link-btn split" onclick={toggleSplit}>{review.split ? t('合併成一則') : t('拆成幾則')}</button>
            {/if}
            <!-- 意思一致時回譯收起來；有差異才攤開並標黃 -->
            <details class="back" open={!!review.back && review.back.check.kind !== 'ok'}>
              <summary>
                {#if review.rechecking}
                  <span class="check stale">{t('檢查中…')}</span>
                {:else if review.staleEn}
                  <span class="check stale">{t('{lang}改過了，', { lang: theirs })}<button class="link-btn" onclick={recheck}>{t('重新檢查')}</button></span>
                {:else if review.back}
                  {@const k = review.back.check.kind}
                  <span class="check {k}">{k === 'ok' ? '✓' : k === 'warn' ? '⚠' : 'ℹ'} {review.back.check.summary}</span>
                {:else}
                  <span class="check stale">{t('回譯中…')}</span>
                {/if}
              </summary>
              {#if review.back}
                <p>{#each review.back.segments as s, i (i)}{#if s.flagged}<mark>{s.text}</mark>{:else}{s.text}{/if}{/each}</p>
              {/if}
            </details>
            {#if review.result.notes.length}
              <details class="notes">
                <summary>{t('為什麼這樣寫')}</summary>
                <ol>{#each review.result.notes as note, i (i)}<li><b>{note.term}</b>　{note.why}</li>{/each}</ol>
              </details>
            {/if}
        </div>
        <div class="refine">
          <input id="refine-{scope}" bind:value={refineText} placeholder={t('還想怎麼改？例如：短一點、熱情一點')} aria-label={t('調整指示')} />
          {#if review.applied}
            <span class="applied">{t('已照「{instruction}」改寫，', { instruction: review.applied })}<button class="link-btn" onclick={() => review && setTone(review.tone)}>{t('還原')}</button></span>
          {/if}
        </div>
        <div class="rv-foot">
          <button class="btn ghost" onclick={() => { closeReview(); ta.focus(); }}>{t('取消')}</button>
          <div class="send-area">
            {#if app.readOnly}
              <button class="btn" onclick={() => copyAll(false)}>{t('只複製')}</button>
              <span class="kbd">⌘↩</span>
              <button class="btn primary" onclick={() => copyAll(true)}>{t('複製並打開 Slack')}</button>
            {:else}
              <span class="as-who">{t('傳送到 {where}', { where })}{files.length ? t('，附 {n} 個檔案', { n: files.length }) : ''}</span>
              <span class="kbd">⌘↩</span>
              <button class="btn primary" disabled={!review.armed} onclick={send}>{n > 1 ? t('傳送 {n} 則', { n }) : t('傳送')}</button>
            {/if}
          </div>
        </div>
      {/if}
    </section>
  {/if}

  <div class="composer">
    {#if files.length && !app.readOnly}
      <div class="attachments">
        {#each files as f, i (f.name + i)}
          <span class="att"><span>{f.name}</span><button aria-label={t('移除 {name}', { name: f.name })} onclick={() => (files = files.filter((_, j) => j !== i))}>✕</button></span>
        {/each}
      </div>
    {/if}
    {#if replyTo}
      <div class="ctx-row">
        <span class="ctx reply">{t('回應 {name}：', { name: replyTo.author })}<span class="ex" data-raw>{replyTo.text}</span>
          <button class="x" aria-label={t('取消回應')} onclick={() => (compose.replyTo[scope] = null)}>✕</button></span>
      </div>
    {/if}
    <textarea
      bind:this={ta}
      bind:value={draft}
      rows="2"
      {placeholder}
      aria-label={t('{lang}草稿', { lang: mine })}
      onkeydown={onDraftKey}
      oninput={onDraftInput}
      onpaste={onPaste}
    ></textarea>
    <div class="tools">
      {#if !app.readOnly}
        <input type="file" multiple hidden bind:this={fileInput} onchange={(e) => addFiles((e.currentTarget as HTMLInputElement).files)} />
        <button class="icon-btn" aria-label={t('附加檔案')} onclick={() => fileInput?.click()}>{@html ICON.plus}</button>
      {/if}
      <button class="icon-btn" aria-label={t('提及')} onclick={() => insertAt('@')}>{@html ICON.at}</button>
      <button class="icon-btn" aria-label={t('表情符號')} onclick={emojiPick}>{@html ICON.smile}</button>
      <span class="spacer"></span>
      {#if !app.readOnly && !draft.trim() && files.length}
        <button class="btn primary" onclick={sendFilesOnly}>{t('傳送檔案')}</button>
      {:else}
        <span class="kbd">⌘↩</span>&nbsp;
        <button class="btn primary" onclick={polish}>{@html ICON.spark}{same ? t('潤色') : t('潤色成{lang}', { lang: theirs })}</button>
      {/if}
    </div>
  </div>
</div>

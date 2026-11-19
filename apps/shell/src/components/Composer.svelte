<script lang="ts">
  import { aiErrText } from '../lib/translate/errors';
  import { tick, untrack } from 'svelte';
  import { app } from '../lib/store.svelte';
  import { ICON } from '../lib/icons';
  import { compose, ui, anchorOf, type ComposerScope } from '../lib/ui.svelte';
  import { emojiChar } from '../lib/emoji';
  import { GLOSSARY, polisher, verifier, llmStatus, type PolishDraft, type PolishRequest, type Tone, type BackSegment, type MeaningCheck } from '../lib/translate';
  import { SAMPLE_DRAFT } from '../lib/demo/data';

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

  let draft = $state(untrack(() => (scope === 'main' && app.source?.kind === 'demo' ? SAMPLE_DRAFT : '')));
  let files = $state<File[]>([]);
  let review = $state<Review | null>(null);
  let ta: HTMLTextAreaElement;
  let reviewEl = $state<HTMLElement>();
  let fileInput = $state<HTMLInputElement>();
  let refineText = $state('');
  let armTimer: ReturnType<typeof setTimeout> | null = null;

  const replyTo = $derived(compose.replyTo[scope]);
  const label = $derived(app.convLabel(channel));
  const where = $derived(threadTs ? `${label} 的對話串` : label);
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
      draftZh: review?.draftAtPolish ?? draft.trim(),
      channel: label,
      recent: source.slice(-20).map((m) => ({ author: app.name(m.user), text: app.plain(m.text) })),
      replyTo: replyTo ? { author: replyTo.author, text: replyTo.text } : null,
      tone,
      glossary: GLOSSARY,
      sample: all
        .filter((m) => m.user && m.user !== app.self?.id && !m.subtype)
        .slice(-200)
        .map((m) => ({ author: app.name(m.user), text: app.plain(m.text), ts: Number(m.ts) })),
      myVoice: all
        .filter((m) => m.user === app.self?.id && !m.subtype && /[a-z]/i.test(m.text) && !/[\u3400-\u9fff]/.test(m.text))
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
    const back = await verifier.backTranslate(texts, label);
    r.back = await verifier.compare(r.draftAtPolish, back, texts);
  }

  async function polish() {
    const text = draft.trim();
    if (!text) {
      if (files.length && !app.readOnly) return sendFilesOnly();
      ta.focus();
      app.toast('先用中文寫點什麼');
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
      app.toast('潤色沒有完成：' + aiErrText(e));
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
      app.toast('重寫沒有完成：' + aiErrText(e));
    }
    r.loading = false;
    r.loadingLabel = null;
    r.gen++;
    arm();
  }

  function setTone(t: Tone) {
    if (!review || (t === review.tone && !review.applied)) return;
    rewrite(() => polisher.polish(request(t)), '換個語氣重寫…', { tone: t, applied: null });
  }
  function refine(instruction: string) {
    const t = instruction.trim();
    if (!review?.result || !t) return;
    const prev = review.result;
    refineText = '';
    rewrite(() => polisher.refine(request(review!.tone), prev, t), `照「${t}」重寫…`, { applied: t });
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

  // ---------- 唯讀模式：複製英文，到官方 Slack 貼上送出 ----------
  async function writeClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* 沒有權限或不在安全環境：退到隱藏 textarea */
    }
    const t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(t);
    t.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    t.remove();
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
      app.toast('已複製，但打不開 Slack。請自己切到 Slack 貼上');
      return null;
    }
  }

  async function copyTexts(texts: string[], thenOpen: boolean) {
    const r = review;
    if (!r || r.loading) return;
    const clean = texts.map((t) => t.trim()).filter(Boolean);
    if (!clean.length) return app.toast('英文是空的');
    if (!(await writeClipboard(clean.join('\n\n')))) return app.toast('沒有複製成功。請選取英文，按 ⌘C 複製');
    app.rememberCopy(clean, r.draftAtPolish);
    app.toast('已複製，到 Slack 貼上傳送');
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
    if (!texts.length) return app.toast('英文是空的');
    const snapshot = { review: $state.snapshot(r) as Review, texts, draft, files: [...files], replyTo };
    app.queueSend({
      channel, threadTs, texts, draftZh: r.draftAtPolish, files: [...files],
      onUndo: () => restore(snapshot),
    });
    closeReview();
    draft = '';
    files = [];
    compose.replyTo[scope] = null;
  }

  function sendFilesOnly() {
    const snapshot = { review: null, texts: [], draft, files: [...files], replyTo };
    app.queueSend({ channel, threadTs, texts: [], draftZh: '', files: [...files], onUndo: () => restore(snapshot) });
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

  const TONES: [Tone, string][] = [['casual', '更隨意'], ['natural', '像這個頻道'], ['formal', '更正式']];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="composer-wrap" onkeydown={onWrapKey}>
  {#if review}
    <section class="review" tabindex="-1" aria-label="英文草稿審閱" bind:this={reviewEl}>
      {#if review.loading && !review.result}
        <div class="steps"><div class="s run"><span class="ic"></span>潤色中…</div></div>
      {:else if review.loading}
        <div class="steps"><div class="s run"><span class="ic"></span>{review.loadingLabel}</div></div>
      {:else if review.result}
        {@const ps = parts(review)}
        {@const n = ps.length}
        <div class="rv-head">
          <div class="rv-title">
            英文草稿
            {#if review.staleZh}
              <span class="hint warn">中文改過了，<button class="link-btn" onclick={polish}>重新潤色</button></span>
            {/if}
            {#if llmStatus.fake && review.draftAtPolish !== SAMPLE_DRAFT}
              <span class="hint">這是示範用的英文。到左下「設定」填好 AI 金鑰，才會照你的草稿改寫。</span>
            {/if}
          </div>
          <div class="seg seg-tone" role="tablist" aria-label="語氣">
            {#each TONES as [k, l] (k)}
              <button role="tab" aria-selected={review.tone === k && !review.applied} onclick={() => setTone(k)}>{l}</button>
            {/each}
          </div>
        </div>
        <div class="rv-body fade">
            {#key review.gen}
              {#each ps as t, i (i)}
                <div class="bubble-wrap">
                  <div
                    class="bubble"
                    contenteditable="true"
                    spellcheck="true"
                    role="textbox"
                    tabindex="0"
                    aria-label="第 {i + 1} 則英文"
                    oninput={() => review && (review.staleEn = true)}
                  >{t}</div>
                  {#if app.readOnly}<button class="copy-btn" aria-label="複製第 {i + 1} 則英文" onclick={() => copyBubble(i)}>複製</button>{/if}
                </div>
              {/each}
            {/key}
            {#if review.result.merged}
              <button class="link-btn split" onclick={toggleSplit}>{review.split ? '合併成一則' : '拆成幾則'}</button>
            {/if}
            <!-- 意思一致時回譯收起來；有差異才攤開並標黃 -->
            <details class="back" open={!!review.back && review.back.check.kind !== 'ok'}>
              <summary>
                {#if review.rechecking}
                  <span class="check stale">檢查中…</span>
                {:else if review.staleEn}
                  <span class="check stale">英文改過了，<button class="link-btn" onclick={recheck}>重新檢查</button></span>
                {:else if review.back}
                  {@const k = review.back.check.kind}
                  <span class="check {k}">{k === 'ok' ? '✓' : k === 'warn' ? '⚠' : 'ℹ'} {review.back.check.summary}</span>
                {:else}
                  <span class="check stale">回譯中…</span>
                {/if}
              </summary>
              {#if review.back}
                <p>{#each review.back.segments as s, i (i)}{#if s.flagged}<mark>{s.text}</mark>{:else}{s.text}{/if}{/each}</p>
              {/if}
            </details>
            {#if review.result.notes.length}
              <details class="notes">
                <summary>為什麼這樣寫</summary>
                <ol>{#each review.result.notes as note, i (i)}<li><b>{note.term}</b>　{note.why}</li>{/each}</ol>
              </details>
            {/if}
        </div>
        <div class="refine">
          <input id="refine-{scope}" bind:value={refineText} placeholder="還想怎麼改？例如：短一點、熱情一點" aria-label="調整指示" />
          {#if review.applied}
            <span class="applied">已照「{review.applied}」改寫，<button class="link-btn" onclick={() => review && setTone(review.tone)}>還原</button></span>
          {/if}
        </div>
        <div class="rv-foot">
          <button class="btn ghost" onclick={() => { closeReview(); ta.focus(); }}>取消</button>
          <div class="send-area">
            {#if app.readOnly}
              <button class="btn" onclick={() => copyAll(false)}>只複製</button>
              <span class="kbd">⌘↩</span>
              <button class="btn primary" onclick={() => copyAll(true)}>複製並打開 Slack</button>
            {:else}
              <span class="as-who">傳送到 {where}{files.length ? `，附 ${files.length} 個檔案` : ''}</span>
              <span class="kbd">⌘↩</span>
              <button class="btn primary" disabled={!review.armed} onclick={send}>傳送{n > 1 ? ` ${n} 則` : ''}</button>
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
          <span class="att"><span>{f.name}</span><button aria-label="移除 {f.name}" onclick={() => (files = files.filter((_, j) => j !== i))}>✕</button></span>
        {/each}
      </div>
    {/if}
    {#if replyTo}
      <div class="ctx-row">
        <span class="ctx reply">回應 {replyTo.author}：<span class="ex">{replyTo.text}</span>
          <button class="x" aria-label="取消回應" onclick={() => (compose.replyTo[scope] = null)}>✕</button></span>
      </div>
    {/if}
    <textarea
      bind:this={ta}
      bind:value={draft}
      rows="2"
      placeholder={threadTs ? '在對話串用中文回覆…（⌘↩ 潤色成英文）' : '用中文寫回覆…（⌘↩ 潤色成英文）'}
      aria-label="中文草稿"
      onkeydown={onDraftKey}
      oninput={onDraftInput}
      onpaste={onPaste}
    ></textarea>
    <div class="tools">
      {#if !app.readOnly}
        <input type="file" multiple hidden bind:this={fileInput} onchange={(e) => addFiles((e.currentTarget as HTMLInputElement).files)} />
        <button class="icon-btn" aria-label="附加檔案" onclick={() => fileInput?.click()}>{@html ICON.plus}</button>
      {/if}
      <button class="icon-btn" aria-label="提及" onclick={() => insertAt('@')}>{@html ICON.at}</button>
      <button class="icon-btn" aria-label="表情符號" onclick={emojiPick}>{@html ICON.smile}</button>
      <span class="spacer"></span>
      {#if !app.readOnly && !draft.trim() && files.length}
        <button class="btn primary" onclick={sendFilesOnly}>傳送檔案</button>
      {:else}
        <span class="kbd">⌘↩</span>&nbsp;
        <button class="btn primary" onclick={polish}>{@html ICON.spark}潤色成英文</button>
      {/if}
    </div>
  </div>
</div>

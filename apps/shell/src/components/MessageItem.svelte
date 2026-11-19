<script lang="ts">
  import { app, type ReadingMode } from '../lib/store.svelte';
  import { renderMrkdwn, plainToMrkdwn, mentionsUser, decodeEntities } from '../lib/mrkdwn';
  import { ICON } from '../lib/icons';
  import { timeLabel } from '../lib/format';
  import { esc } from '../lib/format';
  import { ui, compose, anchorOf, type ComposerScope } from '../lib/ui.svelte';
  import type { Message } from '../lib/slack/types';
  import type { Idiom } from '../lib/translate';
  import Avatar from './Avatar.svelte';
  import Reactions from './Reactions.svelte';
  import Files from './Files.svelte';

  let {
    channel,
    m,
    cont = false,
    scope,
    mode,
  }: { channel: string; m: Message; cont?: boolean; scope: ComposerScope; mode: ReadingMode } = $props();

  let editing = $state(false);
  let editText = $state('');
  let confirmDelete = $state(false);

  const mine = $derived(!!m.user && m.user === app.self?.id);
  const draft = $derived(mine ? app.draftFor(m) : undefined);
  const tr = $derived(draft ? undefined : app.translationOf(channel, m));
  const idioms = $derived<Idiom[]>(tr?.idioms ?? []);
  const ctx = $derived(app.mrkdwnCtx);
  const enHtml = $derived(renderMrkdwn(m.text, { ...ctx, idioms: idioms.map((i) => i.phrase) }));
  const zhHtml = $derived(tr ? renderMrkdwn(plainToMrkdwn(tr.zh), ctx) : '');
  // 自動翻譯模式：有譯文就直接取代原文，除非這個聊天切到「顯示原文」
  const autoMode = $derived(mode === 'auto');
  const autoZh = $derived(autoMode && !!tr);
  const author = $derived(m.user ? app.name(m.user) : m.bot_name || 'bot');
  const mentionMe = $derived(!mine && !!app.self && mentionsUser(m.text, app.self.id));
  const replyFaces = $derived(m.reply_users.slice(0, 3));

  const idiomHtml = (i: Idiom) => `<b>${esc(i.phrase)}</b>　${esc(i.meaning)}${i.usage ? `<br>${esc(i.usage)}` : ''}`;

  function onOver(e: MouseEvent | FocusEvent) {
    const el = (e.target as Element).closest('.idiom') as HTMLElement | null;
    if (!el) return;
    const i = idioms.find((x) => x.phrase === el.dataset.idiom);
    if (i) ui.tip = { anchor: anchorOf(el), html: idiomHtml(i) };
  }
  function onOut(e: MouseEvent | FocusEvent) {
    if ((e.target as Element).closest('.idiom')) ui.tip = null;
  }

  function replyTo() {
    compose.replyTo[scope] = { author: author.split(' ')[0], text: app.plain(m.text), ts: m.ts };
    compose.focus[scope] += 1;
  }
  function react(e: MouseEvent) {
    ui.picker = { anchor: anchorOf(e.currentTarget as Element), onPick: (name) => app.toggleReaction(channel, m, name) };
  }
  function startEdit() {
    editText = decodeEntities(m.text);
    editing = true;
  }
  async function saveEdit() {
    const t = editText.trim();
    editing = false;
    if (t && t !== decodeEntities(m.text)) await app.edit(channel, m, t);
  }
  function askDelete() {
    if (confirmDelete) {
      confirmDelete = false;
      app.remove(channel, m);
      return;
    }
    confirmDelete = true;
    setTimeout(() => (confirmDelete = false), 3000);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="msg"
  class:cont
  class:mine
  class:mention-me={mentionMe}
  data-ts={m.ts}
  onmouseover={onOver}
  onmouseout={onOut}
  onfocusin={onOver}
  onfocusout={onOut}
>
  <Avatar user={m.user} />
  <div class="body">
    {#if !cont}
      <div class="meta">
        <b>{author}</b><time datetime={new Date(Number(m.ts) * 1000).toISOString()}>{timeLabel(m.ts)}</time>
      </div>
    {/if}

    {#if editing}
      <div class="edit-box">
        <textarea
          bind:value={editText}
          aria-label="修改英文訊息"
          onkeydown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) saveEdit();
            if (e.key === 'Escape') editing = false;
          }}
        ></textarea>
        <div class="row">
          <button class="btn ghost" onclick={() => (editing = false)}>取消</button>
          <button class="btn primary" onclick={saveEdit}>儲存修改</button>
        </div>
      </div>
    {:else if autoZh}
      <div class="zh auto" title="這是譯文；上方切到「原文」可以看英文">{@html zhHtml}{#if m.edited}<span class="edited">（已編輯）</span>{/if}</div>
    {:else if m.text}
      <div class="en">{@html enHtml}{#if m.edited}<span class="edited">（已編輯）</span>{/if}</div>
    {/if}

    {#if draft}
      <div class="zh own"><span class="own-label">你的原稿</span>{draft}</div>
    {:else if autoMode}
      {#if tr === null}<div class="zh loading">翻譯中…</div>{/if}
    {:else if tr && mode !== 'original'}
      <div class="zh">{@html zhHtml}</div>
    {:else if tr === null && mode !== 'original'}
      <div class="zh loading">翻譯中…</div>
    {/if}

    <Files files={m.files} />
    <Reactions {channel} {m} />

    {#if scope === 'main' && m.reply_count > 0}
      <button class="thread-sum" onclick={() => app.openThread(channel, m.ts)}>
        <span class="faces">{#each replyFaces as u (u)}<Avatar user={u} />{/each}</span>
        {m.reply_count} 則回覆
        {#if m.latest_reply}<time>最後回覆 {timeLabel(m.latest_reply)}</time>{/if}
      </button>
    {/if}
  </div>

  <div class="actions">
    {#if !mine}<button onclick={replyTo}>{@html ICON.reply}回覆這則</button>{/if}
    {#if !mine}<button onclick={() => app.retranslate(channel, m)}>{@html ICON.redo}重譯</button>{/if}
    {#if !app.readOnly}<button onclick={react} aria-label="新增表情回應">{@html ICON.smileSm}</button>{/if}
    {#if scope === 'main'}<button onclick={() => app.openThread(channel, m.ts)}>{@html ICON.thread}對話串</button>{/if}
    {#if !app.readOnly && mine && m.text}<button onclick={startEdit}>{@html ICON.pencil}修改</button>{/if}
    {#if !app.readOnly && mine}<button onclick={askDelete}>{@html ICON.trash}{confirmDelete ? '確定刪除？' : '刪除'}</button>{/if}
  </div>
</div>

<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { app, type ReadingMode } from '../lib/store.svelte';
  import { dayKey, dayLabel, timeLabel } from '../lib/format';
  import { ui, type ComposerScope } from '../lib/ui.svelte';
  import type { Message } from '../lib/slack/types';
  import MessageItem from './MessageItem.svelte';
  import Avatar from './Avatar.svelte';

  let {
    channel,
    messages,
    scope,
    threadTs = null,
    mode,
    head,
  }: {
    channel: string;
    messages: Message[];
    scope: ComposerScope;
    threadTs?: string | null;
    mode: ReadingMode;
    head?: Snippet;
  } = $props();

  let el: HTMLDivElement;
  let stick = true; // 使用者在底部時，新訊息進來就跟著捲到底

  // 同一人 5 分鐘內連發的訊息合成一組（不重複顯示頭像與名字）
  const rows = $derived.by(() => {
    const out: { m: Message; cont: boolean; day: string | null }[] = [];
    let prev: Message | null = null;
    for (const m of messages) {
      const day = !prev || dayKey(prev.ts) !== dayKey(m.ts) ? dayLabel(m.ts) : null;
      const cont = !!prev && !day && !m.subtype && prev.user === m.user && Number(m.ts) - Number(prev.ts) < 300 && !prev.reply_count;
      out.push({ m, cont, day });
      prev = m;
    }
    return out;
  });
  const pending = $derived(app.pending.filter((p) => p.channel === channel && p.threadTs === threadTs));

  let inner: HTMLDivElement;
  // 內容長高（新訊息、譯文晚到、圖片載入）時，若原本貼在底部就繼續貼著
  $effect(() => {
    const ro = new ResizeObserver(() => {
      if (stick) el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  });
  $effect(() => {
    void channel;
    stick = true;
  });

  async function onScroll() {
    ui.tip = null;
    stick = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (scope === 'main' && el.scrollTop < 40) {
      const before = el.scrollHeight;
      if (await app.loadOlder(channel)) {
        await tick();
        el.scrollTop = el.scrollHeight - before;
      }
    }
  }
</script>

<div class="feed" data-mode={mode} bind:this={el} onscroll={onScroll}>
<div bind:this={inner} class="feed-inner">
  {@render head?.()}
  {#if scope === 'main' && app.cursors[channel]}
    <div class="older"><button class="link-btn" onclick={() => app.loadOlder(channel)}>載入更早的訊息</button></div>
  {/if}
  {#if !messages.length && !pending.length}
    <div class="empty">{app.loadingHistory ? '載入中…' : '這裡還沒有訊息'}</div>
  {/if}
  {#each rows as r, i (r.m.ts)}
    {#if r.day}<div class="daysep"><span>{r.day}</span></div>{/if}
    <MessageItem {channel} m={r.m} cont={r.cont} {scope} {mode} />
    {#if scope === 'thread' && i === 0 && messages.length > 1}
      <div class="reply-count">{messages.length - 1} 則回覆</div>
    {/if}
  {/each}
  {#each pending as p (p.id)}
    <div class="msg mine pending pending-row">
      <Avatar user={app.self?.id} />
      <div class="body">
        <div class="meta"><b data-raw>{app.name(app.self?.id)}</b><time>{timeLabel(String(Date.now() / 1000))}</time></div>
        {#each p.texts as t, i (i)}<div class="en">{t}</div>{/each}
        {#each p.files as f (f.name)}<div class="en">📎 {f.name}</div>{/each}
        {#if p.draftZh}<div class="zh own"><span class="own-label">你的原稿</span><span data-raw>{p.draftZh}</span></div>{/if}
        <div class="undo">傳送中…　<button class="link-btn" onclick={() => app.undo(p.id)}>撤回（{p.left}）</button></div>
      </div>
    </div>
  {/each}
</div>
</div>

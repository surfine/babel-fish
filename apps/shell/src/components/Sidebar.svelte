<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { ICON } from '../lib/icons';
  import Avatar from './Avatar.svelte';
  import LlmSettings from './LlmSettings.svelte';
  import { llmStatus } from '../lib/translate';
  import { ui } from '../lib/ui.svelte';
  import { installUpdate, updater } from '../lib/updater.svelte';
  import type { Conversation } from '../lib/slack/types';

  const byLabel = (a: Conversation, b: Conversation) => app.convLabel(a.id).localeCompare(app.convLabel(b.id));
  const channels = $derived(app.conversations.filter((c) => c.kind === 'channel' || c.kind === 'private').sort(byLabel));
  const dms = $derived(app.conversations.filter((c) => c.kind === 'im' || c.kind === 'mpim').sort(byLabel));
  const connText = $derived(
    { connecting: '連線中…', live: '即時連線', polling: '即時連線斷了，改成定時更新', offline: '離線' }[app.connection],
  );
</script>

<aside class="sidebar" aria-label="側欄">
  <div class="ws">
    <span data-raw>{app.team?.name ?? 'Slack'}</span>
    {#if app.source?.kind === 'demo'}<span class="demo-tag">示範</span>{/if}
  </div>

  <div class="sec">頻道</div>
  {#each channels as c (c.id)}
    {@render row(c)}
  {/each}

  <div class="sec">私訊</div>
  {#each dms as c (c.id)}
    {@render row(c)}
  {/each}

  <div class="side-foot">
    {#if updater.available}
      <button class="link-btn" onclick={installUpdate} disabled={updater.installing}>
        {updater.installing ? '正在更新…' : `安裝新版 ${updater.available.version} 並重新開啟`}
      </button>
    {/if}
    {#if updater.error}<div class="conn">{updater.error}</div>{/if}
    {#if app.connection !== 'live'}<div class="conn"><span class="dot {app.connection}"></span>{connText}</div>{/if}
    <button class="link-btn" onclick={() => (ui.settings = true)}>設定{llmStatus.fake ? '（還沒填 AI 金鑰）' : ''}</button>
    <button class="link-btn" onclick={() => app.logout()}>{app.source?.kind === 'demo' ? '離開示範' : '登出'}</button>
  </div>
</aside>

{#if ui.settings}<LlmSettings onclose={() => (ui.settings = false)} />{/if}

{#snippet row(c: Conversation)}
  <button
    class="item"
    class:active={c.id === app.activeId}
    class:unread={c.unread > 0 && c.id !== app.activeId}
    onclick={() => app.open(c.id)}
    aria-current={c.id === app.activeId ? 'page' : undefined}
  >
    {#if c.kind === 'im'}
      <Avatar user={c.user_id} cls="avatar av" />
    {:else if c.kind === 'private'}
      {@html ICON.lock}
    {:else if c.kind === 'mpim'}
      <span class="hash">👥</span>
    {:else}
      <span class="hash">#</span>
    {/if}
    <span class="lbl" data-raw>{app.convLabel(c.id)}</span>
    {#if c.mentions > 0 && c.id !== app.activeId}<span class="count" aria-label="{c.mentions} 則提及你">{c.mentions}</span>{/if}
  </button>
{/snippet}

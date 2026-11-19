<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { ICON } from '../lib/icons';
  import Avatar from './Avatar.svelte';
  import LlmSettings from './LlmSettings.svelte';
  import { llmStatus } from '../lib/translate';
  import { ui } from '../lib/ui.svelte';
  import { installUpdate, updater } from '../lib/updater.svelte';
  import type { Conversation } from '../lib/slack/types';
  import { t } from '../lib/i18n';

  const byLabel = (a: Conversation, b: Conversation) => app.convLabel(a.id).localeCompare(app.convLabel(b.id));
  const channels = $derived(app.conversations.filter((c) => c.kind === 'channel' || c.kind === 'private').sort(byLabel));
  const dms = $derived(app.conversations.filter((c) => c.kind === 'im' || c.kind === 'mpim').sort(byLabel));
  const connText = $derived(
    { connecting: t('連線中…'), live: t('即時連線'), polling: t('即時連線斷了，改成定時更新'), offline: t('離線') }[app.connection],
  );
</script>

<aside class="sidebar" aria-label={t('側欄')}>
  <div class="ws">
    <span data-raw>{app.team?.name ?? 'Slack'}</span>
    {#if app.source?.kind === 'demo'}<span class="demo-tag">{t('示範')}</span>{/if}
  </div>

  <div class="sec">{t('頻道')}</div>
  {#each channels as c (c.id)}
    {@render row(c)}
  {/each}

  <div class="sec">{t('私訊')}</div>
  {#each dms as c (c.id)}
    {@render row(c)}
  {/each}

  <div class="side-foot">
    {#if updater.available}
      <button class="link-btn" onclick={installUpdate} disabled={updater.installing}>
        {updater.installing ? t('正在更新…') : t('安裝新版 {version} 並重新開啟', { version: updater.available.version })}
      </button>
    {/if}
    {#if updater.error}<div class="conn">{updater.error}</div>{/if}
    {#if app.connection !== 'live'}<div class="conn"><span class="dot {app.connection}"></span>{connText}</div>{/if}
    <button class="link-btn" onclick={() => (ui.settings = true)}>{t('設定')}{llmStatus.fake ? t('（還沒填 AI 金鑰）') : ''}</button>
    <button class="link-btn" onclick={() => app.logout()}>{app.source?.kind === 'demo' ? t('離開示範') : t('登出')}</button>
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
    {#if c.mentions > 0 && c.id !== app.activeId}<span class="count" aria-label={t('{n} 則提及你', { n: c.mentions })}>{c.mentions}</span>{/if}
  </button>
{/snippet}

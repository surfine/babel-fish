<script lang="ts">
  import { app, type ReadingMode } from '../lib/store.svelte';
  import { ICON } from '../lib/icons';
  import { langName, t } from '../lib/i18n';
  import { LANGS, type Lang } from '@rosetta/llm';
  import MessageFeed from './MessageFeed.svelte';
  import Composer from './Composer.svelte';

  const conv = $derived(app.active);
  const id = $derived(app.activeId ?? '');
  const mode = $derived(app.modeOf(app.activeId));
  const messages = $derived(app.messages[id] ?? []);
  const catchup = $derived(app.catchup[id]);
  // 頻道語言：手動指定的值；空字串代表自動判斷
  const chosen = $derived(app.channelLangs[id] ?? '');
  const detected = $derived(app.detectedLang(id) ?? 'en');

  const MODES: [ReadingMode, string][] = [['auto', t('譯文')], ['both', t('對照')], ['original', t('原文')]];
</script>

<main class="channel">
  {#if conv}
    <header class="ch-head">
      <div class="ch-title">
        {#if conv.kind === 'private'}<span class="private">{@html ICON.lock}</span>{:else if conv.kind === 'channel'}#{/if}
        <span data-raw>{app.convLabel(conv.id)}</span>
        {#if conv.member_count}<span class="members">{t('{n} 位成員', { n: conv.member_count })}</span>{/if}
        {#if conv.topic}<span class="ch-topic" data-raw title={conv.topic}>{conv.topic}</span>{/if}
      </div>
      <div class="ch-tools">
        <label class="ch-lang" title={t('回覆會潤色成這種語言')}>
          <span>{t('這個頻道用')}</span>
          <select value={chosen} onchange={(e) => app.setChannelLang(id, ((e.currentTarget as HTMLSelectElement).value || null) as Lang | null)}>
            <option value="">{t('自動（{lang}）', { lang: langName(detected) })}</option>
            {#each LANGS as l (l)}<option value={l}>{langName(l)}</option>{/each}
          </select>
        </label>
        <div class="seg seg-modes" role="tablist" aria-label={t('閱讀模式')}>
          {#each MODES as [k, l] (k)}
            <button role="tab" aria-selected={mode === k} onclick={() => app.setMode(id, k)}>{l}</button>
          {/each}
        </div>
      </div>
    </header>

    {#key id}
      <MessageFeed channel={id} {messages} scope="main" {mode}>
        {#snippet head()}
          {#if catchup}
            <div class="catchup">
              <h4>{t('你不在的時候有 {n} 則新訊息', { n: catchup.count })}</h4>
              <p>{catchup.text}</p>
              <div class="cu-actions"><button class="link-btn" onclick={() => (app.catchup[id] = null)}>{t('收起')}</button></div>
            </div>
          {/if}
        {/snippet}
      </MessageFeed>
      <Composer channel={id} scope="main" />
    {/key}
  {:else}
    <div class="empty">{t('從左邊選一個頻道或私訊')}</div>
  {/if}
</main>

<style>
  .ch-lang { display: inline-flex; align-items: center; gap: 6px; margin-right: 10px; font-size: 12px; color: var(--text-3); white-space: nowrap; }
  .ch-lang select {
    font: inherit; font-size: 12px; color: var(--text-2); background: var(--bg); border: 1px solid var(--line-2);
    border-radius: 6px; padding: 2px 4px; max-width: 170px;
  }
</style>

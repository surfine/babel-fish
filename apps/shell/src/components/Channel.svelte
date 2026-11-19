<script lang="ts">
  import { app, type ReadingMode } from '../lib/store.svelte';
  import { ICON } from '../lib/icons';
  import MessageFeed from './MessageFeed.svelte';
  import Composer from './Composer.svelte';

  const conv = $derived(app.active);
  const id = $derived(app.activeId ?? '');
  const mode = $derived(app.modeOf(app.activeId));
  const messages = $derived(app.messages[id] ?? []);
  const catchup = $derived(app.catchup[id]);

  const MODES: [ReadingMode, string][] = [['auto', '譯文'], ['both', '對照'], ['original', '原文']];
</script>

<main class="channel">
  {#if conv}
    <header class="ch-head">
      <div class="ch-title">
        {#if conv.kind === 'private'}<span class="private">{@html ICON.lock}</span>{:else if conv.kind === 'channel'}#{/if}
        <span data-raw>{app.convLabel(conv.id)}</span>
        {#if conv.member_count}<span class="members">{conv.member_count} 位成員</span>{/if}
        {#if conv.topic}<span class="ch-topic" data-raw title={conv.topic}>{conv.topic}</span>{/if}
      </div>
      <div class="ch-tools">
        <div class="seg seg-modes" role="tablist" aria-label="閱讀模式">
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
              <h4>你不在的時候有 {catchup.count} 則新訊息</h4>
              <p>{catchup.text}</p>
              <div class="cu-actions"><button class="link-btn" onclick={() => (app.catchup[id] = null)}>收起</button></div>
            </div>
          {/if}
        {/snippet}
      </MessageFeed>
      <Composer channel={id} scope="main" />
    {/key}
  {:else}
    <div class="empty">從左邊選一個頻道或私訊</div>
  {/if}
</main>

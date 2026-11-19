<script lang="ts">
  import { ui, place } from '../lib/ui.svelte';
  import { app } from '../lib/store.svelte';
  import { t } from '../lib/i18n';
  import { QUICK_REACTIONS, allEmojiNames, emojiChar } from '../lib/emoji';

  let tipEl = $state<HTMLElement>();
  let pickerEl = $state<HTMLElement>();
  let q = $state('');

  $effect(() => {
    if (ui.tip && tipEl) place(tipEl, ui.tip.anchor);
  });
  $effect(() => {
    if (ui.picker && pickerEl) {
      q = '';
      place(pickerEl, ui.picker.anchor);
      pickerEl.querySelector('input')?.focus();
    }
  });

  const names = $derived(
    q.trim() ? allEmojiNames().filter((n) => n.includes(q.trim().toLowerCase().replace(/:/g, ''))).slice(0, 64) : QUICK_REACTIONS,
  );

  function choose(n: string) {
    ui.picker?.onPick(n);
    ui.picker = null;
  }

  function onDocClick(e: MouseEvent) {
    const t = e.target as Node;
    if (ui.picker && pickerEl && !pickerEl.contains(t)) ui.picker = null;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (ui.lightbox || ui.picker || ui.tip) e.stopPropagation();
    ui.tip = null;
    ui.picker = null;
    ui.lightbox = null;
  }
</script>

<svelte:document onclick={onDocClick} onkeydown={onKey} />

{#if ui.tip}<div class="tip" role="tooltip" bind:this={tipEl}>{@html ui.tip.html}</div>{/if}

{#if ui.picker}
  <div class="picker" bind:this={pickerEl} role="dialog" aria-label={t('選擇表情')}>
    <input bind:value={q} placeholder={t('搜尋表情，例如 thumbsup')} aria-label={t('搜尋表情')} />
    <div class="grid">
      {#each names as n (n)}
        <button title=":{n}:" onclick={() => choose(n)}>{emojiChar(n)}</button>
      {/each}
    </div>
  </div>
{/if}

{#if ui.lightbox}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="lightbox" onclick={() => (ui.lightbox = null)}>
    <figure style="margin:0">
      <img src={ui.lightbox.src} alt={ui.lightbox.name} />
      <figcaption>{ui.lightbox.name}{t('（點一下關閉）')}</figcaption>
    </figure>
  </div>
{/if}

{#if app.toastMsg}<div class="toast" role="status">{app.toastMsg}</div>{/if}

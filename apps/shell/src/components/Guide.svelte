<script lang="ts">
  // 貼上引導卡：「複製並打開 Slack」之後浮在官方 Slack 旁邊。資料由 Rust 的 guide_* 命令提供。
  import { onMount, untrack } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { t } from '../lib/i18n';

  interface GuideData {
    text: string;
    whereLabel: string;
    isThread: boolean;
    compact: boolean;
    slackUrl: string;
    /** channel、private、im：照 Slack 的寫法顯示頻道名稱 */
    whereKind?: string;
  }

  let { preview = null }: { preview?: GuideData | null } = $props();

  let data = $state<GuideData | null>(untrack(() => preview));
  let sent = $state(false);
  let copiedAgain = $state(false);
  let card: HTMLElement | undefined = $state();

  const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const close = () => (inTauri ? invoke('guide_close') : undefined);

  async function copyAgain() {
    if (!inTauri) return;
    await invoke('guide_copy_again');
    copiedAgain = true;
    setTimeout(() => (copiedAgain = false), 2000);
  }

  // 視窗高度跟著內容走，底部仍對齊 Slack 的輸入框。
  // 卡片在資料到了才出現，所以要等 card 綁定後才開始觀察（之前在 onMount 觀察，card 還不存在，高度從沒回報，底部被裁掉）
  $effect(() => {
    if (!inTauri || !card) return;
    const el = card;
    const report = () => invoke('guide_resize', { height: Math.ceil(el.getBoundingClientRect().height) + 2 });
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  });

  onMount(() => {
    if (!inTauri) return;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    // 放著不管 3 分鐘就收起
    const idle = setTimeout(close, 3 * 60_000);
    invoke<GuideData>('guide_data').then((d) => (data = d));
    const offs = [
      listen<GuideData>('guide://data', (e) => {
        data = e.payload;
        sent = false;
      }),
      listen('guide://sent', () => {
        sent = true;
        closeTimer = setTimeout(close, 2500);
      }),
    ];
    return () => {
      clearTimeout(idle);
      clearTimeout(closeTimer);
      offs.forEach((p) => p.then((off) => off()));
    };
  });
</script>

{#if data}
  <section class="guide" bind:this={card} aria-live="polite">
    {#if sent}
      <div class="g-done">
        <svg class="g-check" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" /><path d="m6 10.2 2.6 2.6L14 7.4" /></svg>
        <div>
          <b>{t('已傳送')}</b>
          <p>{t('Babel Fish 會在這則訊息下方附上你的原稿。')}</p>
        </div>
      </div>
    {:else}
      <header>
        <b>{data.compact ? t('到 Slack 按 ⌘V 貼上') : t('到 Slack 貼上並傳送')}</b>
        <button class="g-x" aria-label={t('關閉提示')} onclick={close}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 5.5 9 9m0-9-9 9" /></svg>
        </button>
      </header>

      {#snippet where(d: GuideData)}<span class="g-where">{#if d.whereKind === 'private'}<svg class="g-lock" viewBox="0 0 20 20" aria-label={t('私人頻道')}><rect x="4.5" y="9" width="11" height="8" rx="1.5" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></svg>{:else if d.whereKind === 'channel'}#{/if}{d.whereLabel.replace(/^#/, '')}</span>{/snippet}

      {#if !data.compact}
        <!-- 要貼的文字只出現在這裡：畫成 Slack 的訊息輸入框，讓人一眼對上 -->
        <div class="g-composer">
          <p class="g-msg">{data.text.replace(/\n{2,}/g, '\n')}</p>
          <span class="g-send" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M3 10.2 16.5 4l-3.6 12.2-3-4.6L3 10.2Zm6.9 1.4 6.6-7.6" /></svg></span>
        </div>
        <ol>
          {#if data.isThread}
            {@const [a, b] = t('在 Slack 打開 {where} 裡那則訊息的對話串', { where: '\u0000' }).split('\u0000')}
            <li>{a}{@render where(data)}{b}</li>
            <li>{@html t('點對話串的訊息輸入框，按 {key}', { key: '<kbd>⌘ V</kbd>' })}</li>
          {:else}
            {@const [a, b] = t('確認 Slack 開的是 {where}，點下方的訊息輸入框', { where: '\u0000' }).split('\u0000')}
            <li>{a}{@render where(data)}{b}</li>
            <li>{@html t('按 {key} 貼上', { key: '<kbd>⌘ V</kbd>' })}</li>
          {/if}
          <li>{@html t('看過一遍，按 {key} 傳送', { key: '<kbd>Return</kbd>' })}</li>
        </ol>
      {:else}
        <!-- 熟手版：不教步驟，只留目的地和文字 -->
        <div class="g-text">
          <small>{t('要貼到')} {#if data.isThread}{@const [a, b] = t('{name} 的對話串', { name: '\u0000' }).split('\u0000')}{a}{@render where(data)}{b}{:else}{@render where(data)}{/if}</small>
          <p class="g-msg">{data.text.replace(/\n{2,}/g, '\n')}</p>
        </div>
      {/if}
      <div class="g-row">
        <button class="g-sbtn" onclick={copyAgain}>{copiedAgain ? t('已複製') : t('再複製一次')}</button>
      </div>
    {/if}
  </section>
{/if}

<style>
  /* 配色、圓角、按鈕照官方 Slack 桌面版（淺色與深色），讓卡片看起來像 Slack 自己的提示 */
  .guide {
    --s-bg: #ffffff;
    --s-text: #1d1c1d;
    --s-text-2: #616061;
    --s-line: rgba(29, 28, 29, 0.13);
    --s-line-strong: rgba(29, 28, 29, 0.3);
    --s-fill: rgba(29, 28, 29, 0.04);
    --s-hover: rgba(29, 28, 29, 0.08);
    --s-green: #007a5a;
    --s-on-green: #ffffff;
    margin: 1px;
    background: var(--s-bg);
    color: var(--s-text);
    border: 1px solid var(--s-line);
    border-radius: 12px;
    padding: 14px 16px 16px;
    font-family: 'Slack-Lato', Lato, -apple-system, BlinkMacSystemFont, 'PingFang TC', sans-serif;
    font-size: 14px;
    line-height: 1.45;
  }
  @media (prefers-color-scheme: dark) {
    .guide {
      --s-bg: #1a1d21;
      --s-text: #d1d2d3;
      --s-text-2: #ababad;
      --s-line: rgba(232, 232, 232, 0.13);
      --s-line-strong: rgba(232, 232, 232, 0.3);
      --s-fill: rgba(232, 232, 232, 0.04);
      --s-hover: rgba(232, 232, 232, 0.08);
    }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: -2px -6px 0 0;
  }
  header b {
    font-size: 15px;
    font-weight: 900;
  }
  .g-x {
    border: 0;
    background: none;
    color: var(--s-text-2);
    width: 28px;
    height: 28px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .g-x svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }
  .g-x:hover {
    background: var(--s-hover);
    color: var(--s-text);
  }
  .g-composer {
    margin-top: 12px;
    border: 1px solid var(--s-line-strong);
    border-radius: 8px;
    padding: 8px 8px 8px 10px;
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }
  .g-composer .g-msg {
    flex: 1;
    margin: 0;
  }
  .g-send {
    width: 28px;
    height: 24px;
    flex: none;
    border-radius: 4px;
    display: grid;
    place-items: center;
    background: var(--s-green);
    color: var(--s-on-green);
  }
  .g-send svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
    stroke: currentColor;
    stroke-width: 1;
    stroke-linejoin: round;
  }
  .guide :global(kbd) {
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    line-height: 18px;
    border: 1px solid var(--s-line-strong);
    border-radius: 4px;
    padding: 0 5px;
    background: var(--s-fill);
    color: var(--s-text);
  }
  ol {
    margin: 12px 0 0;
    padding-left: 20px;
  }
  li {
    margin: 0 0 4px;
  }
  .g-text {
    margin-top: 12px;
  }
  .g-text small {
    color: var(--s-text-2);
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .g-lock {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    margin-left: 2px;
  }
  .g-where {
    font-weight: 700;
    white-space: nowrap;
  }
  .g-text .g-where {
    font-weight: inherit;
  }
  .g-msg {
    margin: 2px 0 0;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    white-space: pre-wrap;
  }
  .g-row {
    margin-top: 12px;
  }
  .g-sbtn {
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    height: 28px;
    padding: 0 12px;
    border-radius: 6px;
    border: 1px solid var(--s-line-strong);
    background: var(--s-bg);
    color: var(--s-text);
    cursor: pointer;
  }
  .g-sbtn:hover {
    background: var(--s-hover);
  }
  .g-done {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .g-done b {
    font-size: 15px;
    font-weight: 900;
  }
  .g-done p {
    margin: 2px 0 0;
    color: var(--s-text-2);
  }
  .g-check {
    width: 20px;
    height: 20px;
    flex: none;
    margin-top: 1px;
    fill: var(--s-green);
    stroke: none;
  }
  .g-check path {
    fill: none;
    stroke: var(--s-on-green);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>

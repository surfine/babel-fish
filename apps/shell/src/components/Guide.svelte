<script lang="ts">
  // 貼上引導卡：「複製並打開 Slack」之後浮在官方 Slack 旁邊。資料由 Rust 的 guide_* 命令提供。
  import { onMount, untrack } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';

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
          <b>已傳送</b>
          <p>Babel Fish 會在這則訊息下方附上你的中文原稿。</p>
        </div>
      </div>
    {:else}
      <header>
        <b>{data.compact ? '到 Slack 按 ⌘V 貼上' : '到 Slack 貼上並傳送'}</b>
        <button class="g-x" aria-label="關閉提示" onclick={close}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 5.5 9 9m0-9-9 9" /></svg>
        </button>
      </header>

      {#if !data.compact}
        <!-- 縮小版的 Slack 訊息輸入框：⌘V 後文字出現，Return 時傳送鈕亮一下 -->
        <div class="g-demo" aria-hidden="true">
          <div class="g-composer">
            <div class="g-line"><span class="g-typed">{data.text.split('\n')[0]}</span><span class="g-caret"></span></div>
            <div class="g-bar">
              <span class="g-keys"><kbd class="k-paste">⌘ V</kbd><kbd class="k-send">Return</kbd></span>
              <span class="g-send"><svg viewBox="0 0 20 20"><path d="M3 10.2 16.5 4l-3.6 12.2-3-4.6L3 10.2Zm6.9 1.4 6.6-7.6" /></svg></span>
            </div>
          </div>
        </div>
        <ol>
          {#if data.isThread}
            <li>在 Slack 打開那則訊息的對話串</li>
            <li>點對話串的訊息輸入框，按 <kbd>⌘ V</kbd></li>
          {:else}
            <li>點 Slack 下方的訊息輸入框</li>
            <li>按 <kbd>⌘ V</kbd> 貼上</li>
          {/if}
          <li>看過一遍，按 <kbd>Return</kbd> 傳送</li>
        </ol>
      {:else if data.isThread}
        <p class="g-note">這是對話串的回覆，先在 Slack 打開那個對話串。</p>
      {/if}

      <div class="g-text">
        <small>
          要貼到
          {#if data.whereKind === 'private'}<svg class="g-lock" viewBox="0 0 20 20" aria-label="私人頻道"><rect x="4.5" y="9" width="11" height="8" rx="1.5" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></svg>{:else if data.whereKind === 'channel'}#{/if}{data.whereLabel.replace(/^#/, '')}{data.isThread ? ' 的對話串' : ''}
        </small>
        <p>{data.text.replace(/\n{2,}/g, '\n')}</p>
      </div>
      <div class="g-row">
        <button class="g-sbtn" onclick={copyAgain}>{copiedAgain ? '已複製' : '再複製一次'}</button>
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
  .g-demo {
    margin: 10px 0 2px;
  }
  .g-composer {
    border: 1px solid var(--s-line-strong);
    border-radius: 8px;
    padding: 8px 8px 6px 10px;
  }
  .g-line {
    height: 22px;
    display: flex;
    align-items: center;
    overflow: hidden;
    white-space: nowrap;
  }
  .g-typed {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 0;
    animation: paste 6s cubic-bezier(0.23, 1, 0.32, 1) infinite;
  }
  .g-caret {
    width: 1px;
    height: 16px;
    background: var(--s-text);
    margin-left: 1px;
    flex: none;
  }
  .g-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 6px;
  }
  .g-keys {
    display: flex;
    gap: 6px;
  }
  .g-send {
    width: 28px;
    height: 24px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    background: var(--s-fill);
    color: var(--s-text-2);
    animation: armed 6s infinite;
  }
  .g-send svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
    stroke: currentColor;
    stroke-width: 1;
    stroke-linejoin: round;
  }
  kbd {
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
  .k-paste {
    animation: press 6s infinite;
  }
  .k-send {
    animation: press 6s 2.4s infinite;
  }
  /* 0.6 秒按下 ⌘V，文字出現；2.4 秒按 Return，傳送鈕亮；之後清空重來 */
  @keyframes paste {
    0%,
    10% {
      max-width: 0;
    }
    14%,
    85% {
      max-width: 100%;
    }
    92%,
    100% {
      max-width: 0;
    }
  }
  @keyframes press {
    0%,
    8%,
    16%,
    100% {
      background: var(--s-fill);
      color: var(--s-text);
      border-color: var(--s-line-strong);
    }
    10%,
    14% {
      background: var(--s-green);
      color: var(--s-on-green);
      border-color: var(--s-green);
    }
  }
  /* 文字貼上後傳送鈕變綠（和 Slack 一樣：有內容才亮），Return 之後清空就變回灰 */
  @keyframes armed {
    0%,
    12%,
    90%,
    100% {
      background: var(--s-fill);
      color: var(--s-text-2);
    }
    14%,
    85% {
      background: var(--s-green);
      color: var(--s-on-green);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .g-typed {
      animation: none;
      max-width: 100%;
    }
    .k-paste,
    .k-send {
      animation: none;
    }
    .g-send {
      animation: none;
      background: var(--s-green);
      color: var(--s-on-green);
    }
  }
  ol {
    margin: 12px 0 0;
    padding-left: 20px;
  }
  li {
    margin: 0 0 4px;
  }
  .g-note {
    margin: 8px 0 0;
    color: var(--s-text-2);
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
  .g-text p {
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

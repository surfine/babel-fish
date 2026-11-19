// 浮層狀態：俚語提示、面板、表情挑選器、圖片燈箱。全畫面只有一份。
export interface Anchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
}

export const ui = $state({
  tip: null as { anchor: Anchor; html: string } | null,
  picker: null as { anchor: Anchor; onPick: (name: string) => void } | null,
  lightbox: null as { src: string; name: string } | null,
  // 設定面板：側欄左下的「設定」或選單列的 Rosetta › 設定…（⌘,）
  settings: false,
});

export const anchorOf = (el: Element): Anchor => {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
};

// 依錨點擺放浮層：預設在下方置中，放不下就翻到上方
export function place(box: HTMLElement, a: Anchor, gap = 8, alignRight = false) {
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  let x = alignRight ? a.right - w : a.left + a.width / 2 - w / 2;
  x = Math.min(Math.max(8, x), innerWidth - w - 8);
  let y = a.bottom + gap;
  if (y + h > innerHeight - 8) y = Math.max(8, a.top - h - gap);
  box.style.left = x + 'px';
  box.style.top = y + 'px';
}

export type ComposerScope = 'main' | 'thread';

// 「回覆這則」：指定潤色時要回應的訊息，主頻道與討論串各一個
export const compose = $state({
  replyTo: { main: null, thread: null } as Record<ComposerScope, { author: string; text: string; ts: string } | null>,
  focus: { main: 0, thread: 0 } as Record<ComposerScope, number>,
});

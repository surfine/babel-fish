import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import Guide from './components/Guide.svelte';
import { refreshLLM } from './lib/translate';
import { convertUI, loadVariant, makeConverter } from './lib/zh';

// 同一份前端也給「貼上引導卡」視窗用（Rust 開的 guide 視窗）；瀏覽器裡 ?guide 可以預覽
const internals = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__;
const isGuide = internals?.metadata?.currentWindow?.label === 'guide' || new URLSearchParams(location.search).has('guide');
const target = document.getElementById('app')!;

const GUIDE_PREVIEW = {
  text: 'same here, no AirPods showing up on beta 4 for me either\n\nmaybe they only show up after the iPad restarts? will try again in a bit',
  whereLabel: 'newsroom',
  whereKind: 'private',
  isThread: new URLSearchParams(location.search).has('thread'),
  compact: new URLSearchParams(location.search).has('compact'),
  slackUrl: '',
};

export default isGuide
  ? (document.documentElement.classList.add('guide-window'), mount(Guide, { target, props: { preview: internals ? null : GUIDE_PREVIEW } }))
  : mount(App, { target });

if (!isGuide) refreshLLM().catch((e) => console.warn('讀取 AI 金鑰狀態失敗', e));

// 中文地區用字：介面原文是台灣正體，選了其他地區就轉換畫面上的文字（見 lib/zh.ts）
const zhVariant = loadVariant();
document.documentElement.lang = zhVariant;
if (zhVariant !== 'zh-TW') makeConverter(zhVariant).then((c) => convertUI(document.body, c));

// 開發用：主控台可用 __app 檢查狀態；?demo&shot=review|thread|zh 直接擺好截圖用的畫面
if (import.meta.env.DEV) {
  import('./lib/store.svelte').then(({ app }) => ((window as unknown as { __app: unknown }).__app = app));
  const shot = new URLSearchParams(location.search).get('shot');
  const click = (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.click();
  if (shot)
    setTimeout(() => {
      if (shot === 'review') click('.composer .btn.primary');
      if (shot === 'thread') click('.thread-sum');
      if (shot === 'zh') document.querySelectorAll<HTMLElement>('.seg-modes button')[1]?.click();
    }, 800);
}

import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import Guide from './components/Guide.svelte';
import { refreshLLM } from './lib/translate';
import { rustStrings, userLang } from './lib/i18n';

// 同一份前端也給「貼上引導卡」視窗用（Rust 開的 guide 視窗）；瀏覽器裡 ?guide 可以預覽
const internals = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__;
const isGuide = internals?.metadata?.currentWindow?.label === 'guide' || new URLSearchParams(location.search).has('guide');
const target = document.getElementById('app')!;

const GUIDE_PREVIEW = {
  text: 'same here, the green on my sample looks darker than the swatch too\n\nmaybe it’s the lighting? will take another photo tomorrow in daylight',
  whereLabel: 'product',
  whereKind: 'private',
  isThread: new URLSearchParams(location.search).has('thread'),
  compact: new URLSearchParams(location.search).has('compact'),
  slackUrl: '',
};

// 介面語言（「我的語言」）。Rust 端的選單列、錯誤訊息、視窗標題也要跟著換：
// 先把語言和 Rust 要用的字串交給 Rust，再掛上畫面，這樣啟動時的錯誤訊息就已經是對的語言
const lang = userLang();
document.documentElement.lang = lang;
const ready: Promise<unknown> =
  internals && !isGuide
    ? import('@tauri-apps/api/core').then(({ invoke }) => invoke('set_ui_locale', { locale: lang, strings: rustStrings() })).catch(() => {})
    : Promise.resolve();

let mounted: ReturnType<typeof mount> | undefined;
ready.then(() => {
  mounted = isGuide
    ? (document.documentElement.classList.add('guide-window'), mount(Guide, { target, props: { preview: internals ? null : GUIDE_PREVIEW } }))
    : mount(App, { target });
});
export default () => mounted;

if (!isGuide) refreshLLM().catch((e) => console.warn('讀取 AI 金鑰狀態失敗', e));

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

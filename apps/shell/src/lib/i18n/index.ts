// 介面文字：t('台灣正體原文', { 參數 })。原文就是鍵，台灣正體不查表。
// 英文目錄手寫（en.ts）；香港、大陆、马新的目錄在建置時由術語表＋OpenCC 產生（virtual:i18n，見 scripts/i18n-plugin.ts）。
// 「我的語言」在啟動時讀一次；換語言會重新載入頁面。
//
// 參數寫成 {name}；英文的單複數寫成 {n:reply|replies}（n 是 1 用前者，其餘用後者）。
import { DEFAULT_LANG, isLang, isZh, langFromLocales, type Lang } from '@rosetta/llm';
import { demo, regions, rustKeys } from 'virtual:i18n';
import en from './en';

export const LANG_KEY = 'rosetta.userLang';
// 改版前的「中文用字」設定，讀得到就沿用
const LEGACY_ZH_KEY = 'rosetta.zhVariant';

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 使用者語言：設定過就用設定；舊版的「中文用字」；否則依系統語言猜 */
export function loadUserLang(): Lang {
  const v = stored(LANG_KEY) ?? stored(LEGACY_ZH_KEY);
  if (isLang(v)) return v;
  if (typeof navigator === 'undefined') return DEFAULT_LANG;
  return langFromLocales(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

export function saveUserLang(l: Lang) {
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* 私密模式等情況存不了就算了 */
  }
}

const tableFor = (l: Lang): Record<string, string> | null => (l === 'zh-TW' ? null : l === 'en' ? en : regions[l]);

let current: Lang = loadUserLang();
let table = tableFor(current);

/** 目前的使用者語言 */
export const userLang = () => current;

/** 只給測試用：換語言（App 裡換語言會重新載入頁面） */
export function setUserLangForTest(l: Lang) {
  current = l;
  table = tableFor(l);
}

export type Params = Record<string, string | number>;

export function format(s: string, params?: Params): string {
  if (!params) return s;
  return s.replace(/\{(\w+)(?::([^}|]*)\|([^}]*))?\}/g, (m, name: string, one?: string, other?: string) => {
    const v = params[name];
    if (v === undefined) return m;
    if (one !== undefined) return Number(v) === 1 ? one : (other ?? '');
    return String(v);
  });
}

export function t(key: string, params?: Params): string {
  return format(table?.[key] || key, params);
}

/** Rust 端要顯示的字串（錯誤訊息、視窗標題）：啟動時翻好交給 Rust */
export function rustStrings(): Record<string, string> {
  return Object.fromEntries(rustKeys.map((k) => [k, t(k)]));
}

/** 「潤色成…」「這個頻道用…」裡的語言名稱，用使用者語言寫 */
export function langName(l: Lang, u: Lang = current): string {
  if (l === 'en') return t('英文');
  if (isZh(u) && l === u) return t('中文');
  return {
    'zh-TW': t('中文（台灣用字）'),
    'zh-HK': t('中文（香港用字）'),
    'zh-CN': t('中文（大陸用字）'),
    'zh-SG': t('中文（馬新用字）'),
  }[l];
}

/** 示範資料裡預寫的中文（台灣正體）換成目前地區的寫法；英文與台灣原樣回傳 */
export function regional(s: string): string {
  if (current === 'en' || current === 'zh-TW') return s;
  return demo[current][s] ?? s;
}

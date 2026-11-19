// 介面的中文地區用字（像維基百科的字詞轉換）：介面原文是台灣正體，
// 選了其他地區時，先照 packages/llm 的術語表換用詞，再用 OpenCC 換字形。
// 譯文、回譯、摘要不靠這裡：它們直接請模型用選的地區寫（見 translate/llm.ts）。
//
// 不轉換：人寫的原文（訊息、你的原稿）、人名、頻道名。這些元素標 data-raw。
import { DEFAULT_ZH, TERMS, ZH_VARIANTS, termIn, type ZhVariant } from '@rosetta/llm';

export const ZH_KEY = 'rosetta.zhVariant';

/** 依系統語言猜預設：zh-CN／zh-Hans → 大陆简体；zh-HK、zh-MO → 香港繁體；zh-SG、zh-MY → 马新简体；其他 → 台灣正體 */
export function variantFromLocales(locales: readonly string[]): ZhVariant {
  for (const raw of locales) {
    const l = raw.toLowerCase();
    if (!l.startsWith('zh')) continue;
    if (/-(sg|my)\b/.test(l)) return 'zh-SG';
    if (/-(hk|mo)\b/.test(l)) return 'zh-HK';
    if (/-(tw)\b/.test(l) || /-hant\b/.test(l)) return 'zh-TW';
    if (/-(cn)\b/.test(l) || /-hans\b/.test(l)) return 'zh-CN';
    return DEFAULT_ZH;
  }
  return DEFAULT_ZH;
}

export function loadVariant(): ZhVariant {
  try {
    const v = localStorage.getItem(ZH_KEY);
    if (v && (ZH_VARIANTS as readonly string[]).includes(v)) return v as ZhVariant;
  } catch {
    /* 讀不到就用系統語言 */
  }
  return variantFromLocales(typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]);
}

export function saveVariant(v: ZhVariant) {
  try {
    localStorage.setItem(ZH_KEY, v);
  } catch {
    /* 私密模式等情況存不了就算了 */
  }
}

/** 大陸與馬新的引號用 “” ‘’；台灣與香港用 「」『』 */
export function convertQuotes(text: string, v: ZhVariant): string {
  if (v !== 'zh-CN' && v !== 'zh-SG') return text;
  return text.replace(/「/g, '“').replace(/」/g, '”').replace(/『/g, '‘').replace(/』/g, '’');
}

/** 台灣用詞 → 目標地區用詞，長詞先換（「資料夾」先於「資料」） */
export function replaceTerms(text: string, v: ZhVariant): string {
  if (v === 'zh-TW') return text;
  const pairs = TERMS.map((t) => [t.tw, termIn(t, v)] as const)
    .filter(([a, b]) => a !== b)
    .sort((a, b) => b[0].length - a[0].length);
  let out = '';
  for (let i = 0; i < text.length; ) {
    const hit = pairs.find(([a]) => text.startsWith(a, i));
    if (hit) {
      out += hit[1];
      i += hit[0].length;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

type Convert = (s: string) => string;

/** 建立「台灣正體 → 目標地區」的轉換函式（OpenCC 在第一次用到時才載入） */
export async function makeConverter(v: ZhVariant): Promise<Convert> {
  if (v === 'zh-TW') return (s) => s;
  const OpenCC = await import('opencc-js');
  const chars = v === 'zh-HK' ? OpenCC.Converter({ from: 'tw', to: 'hk' }) : OpenCC.Converter({ from: 'twp', to: 'cn' });
  const cache = new Map<string, string>();
  return (s) => {
    if (!/[㐀-鿿]/.test(s)) return s;
    let r = cache.get(s);
    if (r === undefined) {
      r = convertQuotes(chars(replaceTerms(s, v)), v);
      if (cache.size > 5000) cache.clear();
      cache.set(s, r);
    }
    return r;
  };
}

const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];

/**
 * 轉換 root 裡所有介面文字，並持續跟著畫面更新。標了 data-raw 的元素（含裡面）不動。
 * 回傳停止函式。zh-TW 什麼都不做。
 */
export function convertUI(root: HTMLElement, convert: Convert): () => void {
  const skip = (n: Node) => {
    const el = n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement;
    return !el || !!el.closest('[data-raw], script, style, textarea, input');
  };
  const fixText = (t: Text) => {
    if (skip(t)) return;
    const next = convert(t.data);
    if (next !== t.data) t.data = next;
  };
  const fixAttrs = (el: Element) => {
    if (el.closest('[data-raw]')) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) {
        const next = convert(v);
        if (next !== v) el.setAttribute(a, next);
      }
    }
  };
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) return fixText(n as Text);
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as Element;
    if (el.hasAttribute('data-raw')) return;
    fixAttrs(el);
    for (const c of Array.from(el.childNodes)) walk(c);
  };
  walk(root);
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') fixText(r.target as Text);
      else if (r.type === 'attributes') fixAttrs(r.target as Element);
      else r.addedNodes.forEach(walk);
    }
  });
  mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  return () => mo.disconnect();
}

/**
 * 使用者語言與頻道語言：英文，或四種地區的中文。
 *
 * 翻譯是「來源 → 使用者語言 U」；寫作是「U 的草稿 → 頻道語言 C」，回譯 C → U，比對用 U。
 * 給模型讀的說明（langInstruction）用英文寫，模型比較穩。
 */
import { DEFAULT_ZH, ZH_LABEL, ZH_VARIANTS, zhInstruction, type ZhVariant } from './zh.js';

export const LANGS = ['en', ...ZH_VARIANTS] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = DEFAULT_ZH;

/** 每種語言用自己的文字寫的名稱（設定裡的選單用） */
export const LANG_NATIVE: Record<Lang, string> = { en: 'English', ...ZH_LABEL };

export const isZh = (l: Lang): l is ZhVariant => l !== 'en';
export const isLang = (x: unknown): x is Lang => typeof x === 'string' && (LANGS as readonly string[]).includes(x);

/** 給模型讀的短名稱 */
export function langName(l: Lang): string {
  return {
    en: 'English',
    'zh-TW': 'Chinese (Taiwan, Traditional)',
    'zh-HK': 'Chinese (Hong Kong, Traditional)',
    'zh-CN': 'Chinese (mainland China, Simplified)',
    'zh-SG': 'Chinese (Singapore/Malaysia, Simplified)',
  }[l];
}

/** 放進提示詞的完整語言說明；中文附上該地區的用詞例子 */
export function langInstruction(l: Lang, examples = 12): string {
  if (l === 'en') return 'natural, idiomatic English as a native speaker would write it';
  return zhInstruction(l, examples);
}

/** 由系統語言猜使用者語言：中文依地區；其他語言一律英文 */
export function langFromLocales(locales: readonly string[]): Lang {
  for (const raw of locales) {
    const l = raw.toLowerCase();
    if (l.startsWith('en')) return 'en';
    if (!l.startsWith('zh')) continue;
    if (/-(sg|my)\b/.test(l)) return 'zh-SG';
    if (/-(hk|mo)\b/.test(l)) return 'zh-HK';
    if (/-(tw)\b/.test(l) || /-hant\b/.test(l)) return 'zh-TW';
    if (/-(cn)\b/.test(l) || /-hans\b/.test(l)) return 'zh-CN';
    return DEFAULT_ZH;
  }
  return locales.length ? 'en' : DEFAULT_LANG;
}

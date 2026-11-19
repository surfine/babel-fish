// 訊息語言判斷：用文字系統的比例判斷，不呼叫模型。只用來決定「這則要不要送去翻譯」，
// 所以寧可判成 unknown（照常翻譯）也不要誤判成使用者看得懂的語言而漏翻。
import { detectScript, isZh, type Lang } from '@rosetta/llm';
import { t } from './i18n';

export type LangCode = 'zh' | 'ja' | 'ko' | 'en' | 'ru' | 'unknown';

export const langLabels = (): Record<Exclude<LangCode, 'unknown'>, string> => ({
  zh: t('中文'),
  en: t('英文'),
  ja: t('日文'),
  ko: t('韓文'),
  ru: t('俄文'),
});

/** 使用者語言對應的「看得懂、不必翻」的語言 */
export const baseLang = (l: Lang): LangCode => (isZh(l) ? 'zh' : 'en');

const RE = {
  han: /[㐀-䶿一-鿿豈-﫿]/g, // i18n-ignore
  kana: /[぀-ヿ]/g,
  hangul: /[가-힯ᄀ-ᇿ]/g,
  latin: /[A-Za-z]/g,
  cyrillic: /[Ѐ-ӿ]/g,
};

const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0;

export function detectLang(text: string): LangCode {
  // 網址、提及、:emoji:、程式碼不算進比例
  const s = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/@\S+/g, ' ')
    .replace(/:[a-z0-9_+-]+:/gi, ' ')
    .replace(/`[^`]*`/g, ' ');
  const han = count(s, RE.han);
  const kana = count(s, RE.kana);
  const hangul = count(s, RE.hangul);
  const latin = count(s, RE.latin);
  const cyr = count(s, RE.cyrillic);
  // 一個中文字的資訊量約等於幾個拉丁字母，換算後再比較
  const scores: [LangCode, number][] = [
    ['ja', kana * 3 + (kana > 0 ? han * 3 : 0)],
    ['zh', kana > 0 ? 0 : han * 3],
    ['ko', hangul * 3],
    ['en', latin],
    ['ru', cyr],
  ];
  const total = scores.reduce((a, [, n]) => a + n, 0);
  if (total < 2) return 'unknown';
  const [best, n] = scores.reduce((a, b) => (b[1] > a[1] ? b : a));
  return n / total >= 0.6 ? best : 'unknown';
}

// 香港書面語偶爾夾的粵語字，看到就判成香港
const CANTONESE = /[嘅咗係唔啲冇喺嘢佢㗎咁哋嚟]/; // i18n-ignore

/**
 * 頻道語言：看最近的訊息（最多 50 則）。中文比英文多就是中文，再依字形分地區：
 * 繁體 → 有粵語字或使用者是香港就判香港，否則台灣；簡體 → 使用者是馬新就判馬新，否則大陸。
 * 訊息太少（少於 3 則能判斷的）回傳 null，由呼叫端退回預設。
 */
export function detectChannelLang(texts: string[], user: Lang): Lang | null {
  let zh = 0;
  let en = 0;
  const zhTexts: string[] = [];
  for (const text of texts.slice(-50)) {
    const l = detectLang(text);
    if (l === 'zh') {
      zh++;
      zhTexts.push(text);
    } else if (l === 'en') en++;
  }
  if (zh + en < 3) return null;
  if (zh <= en) return 'en';
  const joined = zhTexts.join('');
  const script = detectScript(joined) ?? (user === 'zh-CN' || user === 'zh-SG' ? 'simplified' : 'traditional');
  if (script === 'traditional') return CANTONESE.test(joined) || user === 'zh-HK' ? 'zh-HK' : 'zh-TW';
  return user === 'zh-SG' ? 'zh-SG' : 'zh-CN';
}

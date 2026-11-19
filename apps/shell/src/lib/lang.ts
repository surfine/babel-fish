// 訊息語言判斷：用文字系統的比例判斷，不呼叫模型。只用來決定「這則要不要送去翻譯」，
// 所以寧可判成 unknown（照常翻譯）也不要誤判成使用者看得懂的語言而漏翻。
export type LangCode = 'zh' | 'ja' | 'ko' | 'en' | 'ru' | 'unknown';

export const LANG_LABELS: Record<Exclude<LangCode, 'unknown'>, string> = {
  zh: '中文',
  en: '英文',
  ja: '日文',
  ko: '韓文',
  ru: '俄文',
};

const RE = {
  han: /[㐀-䶿一-鿿豈-﫿]/g,
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

// 台灣正體 → 其他中文地區：先照 packages/llm 的術語表換用詞，再用 OpenCC 換字形，最後換引號。
// 只在建置時（vite 外掛 i18n-plugin.ts）和測試裡跑；App 執行時直接讀產生好的目錄。
// 用相對路徑引入術語表：vite 讀設定檔時會把它一起打包；zh.ts 不依賴其他檔案。
// 經 @rosetta/llm 引入的話，Node 會直接執行套件的 TypeScript 原始碼而失敗。
import { TERMS, termIn, type ZhVariant } from '../../../../../packages/llm/src/zh';

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

/** OpenCC 的字形轉換：香港用 tw→hk，大陸與馬新用 twp→cn */
export type CharConverter = (s: string) => string;

export function toRegion(text: string, v: ZhVariant, chars: CharConverter): string {
  if (v === 'zh-TW') return text;
  return convertQuotes(chars(replaceTerms(text, v)), v);
}

/** 由台灣正體的鍵產生一個地區的目錄；overrides 是自動轉換不對時手寫的修正 */
export function generateCatalog(keys: Iterable<string>, v: ZhVariant, chars: CharConverter, overrides: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of [...keys].sort()) out[k] = overrides[k] ?? toRegion(k, v, chars);
  return out;
}

import { TERMS, type Term } from './zh.js';

/** docs/TERMINOLOGY.md 的內容。測試會檢查檔案和這裡一致，改了 TERMS 要跑 npm run terms。 */
export function renderTermsDoc(): string {
  const topics: Term['topic'][] = ['科技', '介面', '工作', '生活'];
  const lines = [
    '# 中文地區用詞對照',
    '',
    'Babel Fish 支援四種中文：台灣正體、香港繁體、大陆简体、马新简体。翻譯、回譯和說明直接請模型用你選的地區寫；介面文字先照這張表換用詞，再用 [OpenCC](https://github.com/BYVoid/OpenCC) 換字形。',
    '',
    '這張表只收字形轉換處理不了的「用詞」差異，以聊天和軟體介面常見的詞為主。做法參考 [taiwan-md 的術語表](https://github.com/frank890417/taiwan-md/blob/main/docs/editorial/TERMINOLOGY.md)，內容是本專案自己整理的。',
    '',
    '這個檔案由 `packages/llm/src/zh.ts` 產生，不要直接改。改完 `TERMS` 後執行 `npm --prefix packages/llm run terms`。',
    '',
  ];
  for (const topic of topics) {
    const rows = TERMS.filter((t) => t.topic === topic);
    lines.push(`## ${topic}`, '', '| 台灣 | 香港 | 大陆 | 马新 | 說明 |', '| --- | --- | --- | --- | --- |');
    for (const t of rows) lines.push(`| ${t.tw} | ${t.hk} | ${t.cn} | ${t.sg} | ${t.note ?? ''} |`);
    lines.push('');
  }
  return lines.join('\n');
}

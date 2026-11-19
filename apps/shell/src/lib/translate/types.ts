// 翻譯與潤色的介面。殼只依賴這些介面；packages/llm 完成後在 index.ts 換掉假實作即可。
// 形狀對齊設計稿的審閱卡：會送出的英文（可拆多則／合併版）、為什麼這樣寫、獨立回譯、意思比對。

export interface GlossaryEntry {
  term: string; // 原文
  zh: string | null; // null 表示不翻譯、保留原文
  note?: string;
}

// ---------- 閱讀翻譯 ----------
export interface TranslateItem {
  id: string; // 呼叫端自訂，回傳時對應
  text: string; // 已把提及、連結轉成純文字（mrkdwnToPlain）
  author?: string;
}

export interface Idiom {
  phrase: string; // 原文裡出現的寫法（用來加底線）
  meaning: string; // 中文意思
  usage?: string; // 用法或例句
}

export interface Translation {
  id: string;
  zh: string;
  idioms: Idiom[];
}

export interface TranslateContext {
  channel: string;
  recent: TranslateItem[]; // 前文，代名詞與省略句才翻得對
  glossary: GlossaryEntry[];
  quality?: 'fast' | 'strong'; // 「重譯」用較強的模型
}

export interface Translator {
  translate(items: TranslateItem[], ctx: TranslateContext): Promise<Translation[]>;
}

// ---------- 寫作潤色 ----------
export type Tone = 'casual' | 'natural' | 'formal';

export interface PolishRequest {
  draftZh: string;
  channel: string;
  recent: { author: string; text: string }[]; // 最近 20 則
  replyTo?: { author: string; text: string } | null;
  tone: Tone;
  glossary: GlossaryEntry[];
  // 算頻道語氣檔案用的樣本（最近約 200 則、不含自己）；沒給就用 recent
  sample?: { author: string; text: string; ts?: number }[];
  // 使用者自己過去寫的英文，讓潤色結果像他
  myVoice?: string[];
}

export interface PolishNote {
  term: string;
  why: string;
}

export interface PolishDraft {
  messages: string[]; // 預設拆成連發的幾則
  merged: string | null; // 合併成一則的版本；只有一則時為 null
  notes: PolishNote[]; // 為什麼這樣寫
}

export interface Polisher {
  polish(req: PolishRequest): Promise<PolishDraft>;
  // 「再調整」：短一點、熱情一點……
  refine(req: PolishRequest, previous: PolishDraft, instruction: string): Promise<PolishDraft>;
}

// ---------- 回譯與意思比對 ----------
export type CheckKind = 'ok' | 'warn' | 'info';

export interface BackSegment {
  text: string;
  flagged: boolean; // 黃色標出：多出來的話、語氣變重
}

export interface MeaningCheck {
  kind: CheckKind;
  summary: string; // 例：「也許」寫成了 prob（大概），語氣比你的原稿篤定一點
}

export interface Verifier {
  // 獨立回譯：刻意不給中文原稿，否則模型會抄原稿，檢查就失效
  backTranslate(english: string[], channel: string): Promise<string>;
  // 拿回譯和原稿比對
  compare(draftZh: string, backZh: string, english: string[]): Promise<{ segments: BackSegment[]; check: MeaningCheck }>;
}

// 頻道離開一陣子回來的中文摘要
export interface Summarizer {
  summarize(items: TranslateItem[], channel: string): Promise<string>;
}

// 翻譯與潤色的介面。殼只依賴這些介面；packages/llm 完成後在 index.ts 換掉假實作即可。
// 形狀對齊設計稿的審閱卡：會送出的訊息（可拆多則／合併版）、為什麼這樣寫、獨立回譯、意思比對。
// 方向：使用者語言 U 的草稿 → 頻道語言 C；回譯 C → U。閱讀時譯成 U。
import type { Lang } from '@rosetta/llm';

export interface GlossaryEntry {
  term: string; // 原文
  zh: string | null; // null 表示不翻譯、保留原文（台灣寫法）
  zhVariants?: Partial<Record<'zh-TW' | 'zh-HK' | 'zh-CN' | 'zh-SG', string>>; // 其他地區的譯名
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
  meaning: string; // 意思（使用者語言）
  usage?: string; // 用法或例句
}

export interface Translation {
  id: string;
  text: string; // 譯文（使用者語言）
  idioms: Idiom[];
}

export interface TranslateContext {
  channel: string;
  recent: TranslateItem[]; // 前文，代名詞與省略句才翻得對
  glossary: GlossaryEntry[];
  target: Lang; // 譯成哪個語言（使用者語言）
  quality?: 'fast' | 'strong'; // 「重譯」用較強的模型
}

export interface Translator {
  translate(items: TranslateItem[], ctx: TranslateContext): Promise<Translation[]>;
}

// ---------- 寫作潤色 ----------
export type Tone = 'casual' | 'natural' | 'formal';

export interface PolishRequest {
  draft: string; // 使用者語言寫的草稿
  userLang: Lang;
  channelLang: Lang;
  channel: string;
  recent: { author: string; text: string }[]; // 最近 20 則
  replyTo?: { author: string; text: string } | null;
  tone: Tone;
  glossary: GlossaryEntry[];
  // 算頻道語氣檔案用的樣本（最近約 200 則、不含自己）；沒給就用 recent
  sample?: { author: string; text: string; ts?: number }[];
  // 使用者自己過去在這個頻道寫的訊息（頻道語言），讓潤色結果像他
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
  summary: string; // 例：「也許」寫成了 prob（大概），語氣比你的原稿篤定一點（使用者語言）
}

export interface Verifier {
  // 獨立回譯（頻道語言 → 使用者語言）：刻意不給原稿，否則模型會抄原稿，檢查就失效
  backTranslate(texts: string[], from: Lang, to: Lang): Promise<string>;
  // 拿回譯和原稿比對；摘要用使用者語言
  compare(draft: string, back: string, texts: string[], lang: Lang): Promise<{ segments: BackSegment[]; check: MeaningCheck }>;
}

// 頻道離開一陣子回來的摘要（使用者語言）
export interface Summarizer {
  summarize(items: TranslateItem[], channel: string, target: Lang): Promise<string>;
}

import { z } from 'zod';
import type { LLM } from '../config.js';
import { LLMError } from '../types.js';
import { formatConversation, formatGlossary, runJson, type ContextMessage, type GlossaryEntry, type TaskMeta } from './shared.js';
import { DEFAULT_ZH, zhInstruction, type ZhVariant } from '../zh.js';

/* 閱讀端：逐則翻譯（附俚語註解）、單則用法解釋、未讀摘要。 */

const Idiom = z.strictObject({
  phrase: z.string().describe('the exact substring from the English message'),
  meaning: z.string(),
  usage: z.string(),
});
export type Idiom = z.infer<typeof Idiom>;

const TranslateOut = z.strictObject({
  translations: z.array(z.strictObject({ id: z.string(), zh: z.string(), idioms: z.array(Idiom) })),
});

// 驗證用的寬鬆版：多出的欄位丟掉，缺 idioms 或格式不對就當沒有俚語，id 允許數字
const IdiomLoose = z.object({ phrase: z.string(), meaning: z.string(), usage: z.string().catch('') });
const TranslateLoose: z.ZodType<z.infer<typeof TranslateOut>> = z.object({
  translations: z.array(z.object({ id: z.coerce.string(), zh: z.string(), idioms: z.array(IdiomLoose).catch([]) })),
});

export interface TranslateInput {
  messages: Array<ContextMessage & { id: string }>;
  /** 要翻的訊息之前的對話，只當參考不翻。 */
  context?: ContextMessage[];
  glossary?: GlossaryEntry[];
  /** 譯文用哪個地區的中文，預設台灣正體 */
  variant?: ZhVariant;
  signal?: AbortSignal;
}

export interface Translation {
  id: string;
  zh: string;
  idioms: Idiom[];
}

export const translateSystem = (v: ZhVariant = DEFAULT_ZH) => `You translate Slack messages from English into ${zhInstruction(v)}, for a reader who finds English hard.

- Translate the meaning and the tone, not word by word: a terse, casual message stays terse and casual in Chinese.
- Follow the glossary exactly. Terms marked "keep in English" stay in English with their exact capitalization.
- Keep @mentions, numbers, version strings and URLs as they are.
- For slang, abbreviations and idioms a learner would not know (fwiw, ah k, fine print, -esque, sure does…), add an idiom entry: phrase is the exact substring from the English, meaning is a short Chinese gloss, usage is one Chinese sentence on when people say it, with a short English example if helpful. Ordinary words get no entry; most messages have none.
- Return one translation per input id, in the same order.`;

/**
 * 批次翻譯。超過 batchSize 就分批並行送出，結果按輸入順序回傳。
 * 模型漏掉的訊息會單獨再送一次；仍然漏掉的就不回傳（呼叫端之後可以再要），不讓整批失敗。
 */
export async function translateBatch(llm: LLM, input: TranslateInput, opts: { batchSize?: number } = {}): Promise<{ translations: Translation[]; meta: TaskMeta[] }> {
  const size = opts.batchSize ?? 20;
  const meta: TaskMeta[] = [];

  const once = async (batch: TranslateInput['messages'], earlier: ContextMessage[]) => {
    const user = [
      input.glossary?.length ? `Glossary:\n${formatGlossary(input.glossary, input.variant)}` : '',
      earlier.length ? `Earlier conversation (context only, do not translate):\n${formatConversation(earlier)}` : '',
      `Messages to translate (JSON):\n${JSON.stringify(batch.map((m) => ({ id: m.id, user: m.user, text: m.text })))}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const { data, meta: m } = await runJson(llm, 'translate', 'translations', TranslateOut, translateSystem(input.variant), user, {
      signal: input.signal,
      lenient: TranslateLoose,
    });
    meta.push(m);
    return new Map(data.translations.map((t) => [t.id, t]));
  };

  const chunks: Array<{ batch: TranslateInput['messages']; earlier: ContextMessage[] }> = [];
  for (let i = 0; i < input.messages.length; i += size) {
    chunks.push({ batch: input.messages.slice(i, i + size), earlier: [...(input.context ?? []), ...input.messages.slice(0, i)] });
  }
  const results = await Promise.all(
    chunks.map(async ({ batch, earlier }) => {
      const found = await once(batch, earlier);
      const missing = batch.filter((m) => !found.has(m.id));
      if (missing.length) for (const [id, t] of await once(missing, earlier)) found.set(id, t);
      return { batch, found };
    }),
  );

  const translations: Translation[] = [];
  for (const { batch, found } of results) {
    for (const msg of batch) {
      const t = found.get(msg.id);
      if (!t) continue;
      // 模型給的 phrase 不在原文裡就丟掉，介面才能安全地畫點狀底線。
      translations.push({ id: msg.id, zh: t.zh, idioms: t.idioms.filter((d) => msg.text.includes(d.phrase)) });
    }
  }
  return { translations, meta };
}

const AnnotateOut = z.strictObject({ idioms: z.array(Idiom) });

/** 「解釋用法」：對單則訊息做較完整的俚語與片語說明。 */
export async function annotateIdioms(llm: LLM, input: { message: ContextMessage; context?: ContextMessage[]; variant?: ZhVariant; signal?: AbortSignal }) {
  const system = `You explain English slang, abbreviations, idioms and notable phrasing in a Slack message to a learner who reads ${zhInstruction(input.variant)}. phrase must be an exact substring of the message. meaning: short Chinese gloss. usage: one or two Chinese sentences on when and how people say it, with a short English example. Include anything a learner could misread; skip plain words.`;
  const user = [input.context?.length ? `Conversation so far:\n${formatConversation(input.context)}` : '', `Message:\n[${input.message.user}] ${input.message.text}`]
    .filter(Boolean)
    .join('\n\n');
  const { data, meta } = await runJson(llm, 'annotate', 'idioms', AnnotateOut, system, user, { signal: input.signal });
  return { idioms: data.idioms.filter((d) => input.message.text.includes(d.phrase)), meta };
}

const SummaryOut = z.strictObject({ summary: z.string() });

/** 離開一陣子回來時的中文摘要。 */
export async function summarizeUnread(llm: LLM, input: { messages: ContextMessage[]; glossary?: GlossaryEntry[]; variant?: ZhVariant; signal?: AbortSignal }) {
  const system = `Summarize these Slack messages in ${zhInstruction(input.variant)}, for someone returning after a break: one short paragraph, who said what and what was concluded, concrete names, versions and numbers. Follow the glossary. No headings, no bullet points.`;
  const user = [input.glossary?.length ? `Glossary:\n${formatGlossary(input.glossary, input.variant)}` : '', `Messages:\n${formatConversation(input.messages, input.messages.length)}`]
    .filter(Boolean)
    .join('\n\n');
  const { data, meta } = await runJson(llm, 'summarize', 'summary', SummaryOut, system, user, { signal: input.signal });
  return { summary: data.summary, meta };
}

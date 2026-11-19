import { z } from 'zod';
import type { LLM } from '../config.js';
import { describeToneProfile, type ToneProfile } from '../tone.js';
import { formatConversation, formatGlossary, runJson, type ContextMessage, type GlossaryEntry, type TaskMeta } from './shared.js';
import { DEFAULT_ZH, ZH_LABEL, zhInstruction, type ZhVariant } from '../zh.js';

/* 寫作端：潤色（三種語氣）→ 獨立回譯（只看英文）→ 意思比對。資料形狀對應 design/prototype.html 的審閱卡。 */

export const TONES = ['casual', 'channel', 'formal'] as const;
export type Tone = (typeof TONES)[number];

const Variant = z.strictObject({
  bubbles: z.array(z.string()).describe('the messages to send, in order; 1–3 items'),
  merged: z.string().nullable().describe('all bubbles as one message in the same style; null when there is only one bubble'),
  notes: z.array(z.strictObject({ phrase: z.string(), why: z.string() })),
});
export type PolishVariant = z.infer<typeof Variant>;

const PolishOut = z.strictObject({ casual: Variant, channel: Variant, formal: Variant });
export type PolishResult = z.infer<typeof PolishOut>;

export interface PolishInput {
  /** 使用者的中文草稿。 */
  draft: string;
  /** 最近的頻道訊息（會取最後 20 則）。 */
  recent: ContextMessage[];
  /** 使用者指定要回應的那則。 */
  replyTo?: ContextMessage;
  tone: ToneProfile;
  glossary?: GlossaryEntry[];
  /** 使用者自己過去寫過的英文訊息，讓結果像他。 */
  myVoice?: string[];
  /** 「再調整」：例如「短一點」「熱情一點」。 */
  instruction?: string;
  /** 使用者讀寫的中文地區；「為什麼這樣寫」、回譯與比對都用它 */
  variant?: ZhVariant;
  signal?: AbortSignal;
  onText?: (d: string) => void;
}

export const polishSystem = (v: ZhVariant = DEFAULT_ZH) => `You turn a Chinese draft (written in ${ZH_LABEL[v]} by a member of a Slack channel) into the English messages they will send. They will read your output carefully before sending it under their own name, so it must say exactly what they meant, in the way people in this channel actually write.

Meaning
- Say everything in the draft and nothing more. Do not add facts, offers, promises ("will report back"), thanks, greetings, praise or opinions that are not in the draft.
- Keep hedges at the same strength: 也許/可能 → maybe/might/could; 應該 → should/probably; 一定 → definitely. Do not turn "maybe" into "prob" or "definitely", or soften a firm statement.
- A question stays a question in every variant, even the casual one: if the user is asking for confirmation, the English must still read as asking.
- Resolve pronouns and omitted subjects from the conversation; if the user is replying to a message, the English must read as a reply to it.

Sounding native
- Match the channel profile: capitalization, ending punctuation, message length, abbreviations, bursts.
- Avoid translationese: no em dashes, no "Great point!", no "Hope this helps", no "I also have the same situation", no over-politeness, no exclamation flooding, no stiff complete sentences where the channel writes fragments.
- Product names follow the glossary and Apple's official capitalization (iOS 27.2, tvOS 27, Siri Remote, Find My).

Three variants
- casual: looser than the channel (shorter, more abbreviations), still the same meaning.
- channel: what a regular in this channel would write. This is the default the user will most likely send.
- formal: complete sentences, normal capitalization and punctuation, usually one message; for editors or people the user does not know well.
- bubbles: split the way this channel splits messages (bursts of short messages are normal here); 1–3 bubbles. merged: the same content as a single message, or null if there is one bubble.
- notes: 2–4 per variant. phrase is a key English phrase from that variant (or a short label for a style choice); why is one sentence in ${zhInstruction(v, 6)}, explaining why it is written that way, so the user learns from it.`;
export const POLISH_SYSTEM = polishSystem();

export function buildPolishPrompt(input: PolishInput): string {
  const parts = [
    `Channel style profile:\n${describeToneProfile(input.tone)}`,
    input.myVoice?.length ? `English messages the user has written before (match their voice):\n${input.myVoice.map((t) => `> ${t}`).join('\n')}` : '',
    input.glossary?.length ? `Glossary:\n${formatGlossary(input.glossary, input.variant)}` : '',
    `Recent conversation (oldest first):\n${formatConversation(input.recent)}`,
    input.replyTo ? `The user is replying to:\n[${input.replyTo.user}] ${input.replyTo.text}` : '',
    `The user's Chinese draft:\n${input.draft}`,
    input.instruction ? `Extra instruction from the user: ${input.instruction}` : '',
  ];
  return parts.filter(Boolean).join('\n\n');
}

export async function polish(llm: LLM, input: PolishInput): Promise<{ result: PolishResult; meta: TaskMeta }> {
  const { data, meta } = await runJson(llm, 'polish', 'polish', PolishOut, polishSystem(input.variant), buildPolishPrompt(input), { signal: input.signal, onText: input.onText });
  for (const t of TONES) {
    const v = data[t];
    v.bubbles = v.bubbles.map((b) => b.trim()).filter(Boolean);
    if (v.bubbles.length <= 1) v.merged = null;
  }
  return { result: data, meta };
}

const BackOut = z.strictObject({ items: z.array(z.strictObject({ key: z.string(), zh: z.string() })) });

export interface BacktranslateInput {
  /** 要回譯的英文，鍵自訂（例如 casual/channel/formal）。刻意沒有放中文原稿的欄位。 */
  texts: Record<string, string>;
  /** 英文對話脈絡，幫助理解代名詞。 */
  recent?: ContextMessage[];
  /** 讓產品名的中文譯法和使用者原稿一致，比對時才不會把譯名差異當成意思差異。 */
  glossary?: GlossaryEntry[];
  variant?: ZhVariant;
  signal?: AbortSignal;
}

export const backtranslateSystem = (v: ZhVariant = DEFAULT_ZH) => `You translate English Slack messages into ${zhInstruction(v)}, so a reader can check exactly what the English says.
- Be faithful, not nice: keep every added phrase, every hedge at its exact strength (prob = 大概, maybe = 也許, definitely = 一定), every exclamation and the level of politeness.
- Do not fix, smooth over, or guess what the writer meant to say. If the English is odd, the Chinese should be odd in the same way.
- Natural Chinese word order is fine; dropping or adding meaning is not.
- Use the conversation only to understand pronouns and references. Never add names, places or details that the English itself does not say (if the English says "the remote", write 遙控器, not Siri Remote).
- Follow the glossary for product names.`;

/** 獨立回譯：只給英文，絕不給中文原稿，否則模型會照抄原稿讓檢查失效。 */
export const BACKTRANSLATE_SYSTEM = backtranslateSystem();

export async function backtranslate(llm: LLM, input: BacktranslateInput): Promise<{ result: Record<string, string>; meta: TaskMeta }> {
  const keys = Object.keys(input.texts);
  const user = [
    input.glossary?.length ? `Glossary:\n${formatGlossary(input.glossary, input.variant)}` : '',
    input.recent?.length ? `Conversation for context (do not translate):\n${formatConversation(input.recent)}` : '',
    `Translate each item (JSON):\n${JSON.stringify(keys.map((key) => ({ key, en: input.texts[key] })))}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const { data, meta } = await runJson(llm, 'backtranslate', 'backtranslation', BackOut, backtranslateSystem(input.variant), user, { signal: input.signal });
  const result: Record<string, string> = {};
  for (const item of data.items) if (keys.includes(item.key)) result[item.key] = item.zh;
  return { result, meta };
}

const CompareOut = z.strictObject({
  status: z.enum(['ok', 'warn', 'info']),
  summary: z.string(),
  added: z.array(z.string()),
  omitted: z.array(z.string()),
  toneShifts: z.array(z.strictObject({ original: z.string(), now: z.string(), direction: z.enum(['stronger', 'weaker', 'different']) })),
  highlights: z.array(z.string()).describe('exact substrings of the back-translation to highlight'),
});
export type MeaningCheck = z.infer<typeof CompareOut>;

export const compareSystem = (v: ZhVariant = DEFAULT_ZH) => `You check whether an English message, seen through its Chinese back-translation, still says what the user meant in their Chinese draft. The user cannot judge the English themselves; your verdict decides whether they feel safe pressing send.

Compare the draft with the back-translation and report:
- added: things the English says that the draft did not (new facts, promises such as "will report back", thanks, opinions).
- omitted: points in the draft that the English dropped.
- toneShifts: hedges or intensity that changed (也許 → 大概 is stronger; 一定 → 可能 is weaker), politeness or enthusiasm that changed noticeably.
- status: "warn" if anything was added, omitted or noticeably shifted that the user might not want; "info" if the only differences are harmless clarifications (spelling out "iOS", making an implied subject explicit, merging sentences); "ok" if the meaning matches.
- summary: one sentence in ${zhInstruction(v, 6)}, that the user reads first (examples below are in Taiwan form; write yours in the user's region), e.g. 「也許」寫成了 prob（大概），語氣比你的原稿篤定一點 or 意思一致：沒有新增或漏掉資訊.
- highlights: the exact substrings of the back-translation where a difference shows, so the UI can mark them. Empty when status is ok.
Not differences (do not list, do not highlight):
- word order, punctuation, capitalization, casual vs. formal register, unless they change what is being said;
- plain synonyms that come from the back-translator's word choice (細則 vs 小字說明, 升級 vs 更新, 晚點 vs 等一下, 精確尋找 vs Precision Finding).
Making explicit something the conversation already establishes (the full product name, "iOS", which app the conversation is about) is "info", not "warn".`;

export interface CompareInput {
  draft: string;
  backtranslation: string;
  /** 可選：給比對模型看英文本身，能更準地判斷語氣。 */
  english?: string;
  /** 英文對話脈絡：判斷「補上的資訊」是不是對話早已確立的。 */
  recent?: ContextMessage[];
  variant?: ZhVariant;
  signal?: AbortSignal;
}

export const COMPARE_SYSTEM = compareSystem();

export async function compareMeaning(llm: LLM, input: CompareInput): Promise<{ result: MeaningCheck; meta: TaskMeta }> {
  const user = [
    input.recent?.length ? `Conversation so far:\n${formatConversation(input.recent)}` : '',
    `User's Chinese draft:\n${input.draft}`,
    input.english ? `English to be sent:\n${input.english}` : '',
    `Back-translation of the English:\n${input.backtranslation}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const { data, meta } = await runJson(llm, 'compare', 'meaning_check', CompareOut, compareSystem(input.variant), user, { signal: input.signal });
  // 只保留真的出現在回譯裡的片段，介面才能安全地標黃。
  data.highlights = data.highlights.filter((h) => h && input.backtranslation.includes(h));
  if (data.status === 'ok') data.highlights = [];
  return { result: data, meta };
}

export interface ReviewVariant extends PolishVariant {
  /** 實際會送出的英文（拆則時用換行連起來）。 */
  english: string;
  back: string;
  check: MeaningCheck;
}

export interface ReviewCard {
  draft: string;
  variants: Record<Tone, ReviewVariant>;
  meta: { polish: TaskMeta; backtranslate: TaskMeta; compare: TaskMeta[] };
}

/** 完整審閱卡：polish → 三種語氣一次回譯 → 三個比對並行。 */
export async function reviewDraft(llm: LLM, input: PolishInput): Promise<ReviewCard> {
  const { result, meta: polishMeta } = await polish(llm, input);
  const english = Object.fromEntries(TONES.map((t) => [t, result[t].bubbles.join('\n')])) as Record<Tone, string>;
  const { result: back, meta: backMeta } = await backtranslate(llm, { texts: english, recent: input.recent, glossary: input.glossary, variant: input.variant, signal: input.signal });
  const checks = await Promise.all(
    TONES.map((t) => compareMeaning(llm, { draft: input.draft, backtranslation: back[t] ?? '', english: english[t], recent: input.recent, variant: input.variant, signal: input.signal })),
  );
  const variants = Object.fromEntries(
    TONES.map((t, i) => [t, { ...result[t], english: english[t], back: back[t] ?? '', check: checks[i].result }]),
  ) as Record<Tone, ReviewVariant>;
  return { draft: input.draft, variants, meta: { polish: polishMeta, backtranslate: backMeta, compare: checks.map((c) => c.meta) } };
}

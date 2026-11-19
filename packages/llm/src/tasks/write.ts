import { z } from 'zod';
import type { LLM } from '../config.js';
import { describeToneProfile, type ToneProfile } from '../tone.js';
import { formatConversation, formatGlossary, runJson, type ContextMessage, type GlossaryEntry, type TaskMeta } from './shared.js';
import { isZh, langInstruction, langName, type Lang } from '../lang.js';

/*
 * 寫作端：潤色（三種語氣）→ 獨立回譯（只看潤色結果）→ 意思比對。資料形狀對應 design/prototype.html 的審閱卡。
 * 方向：使用者語言 U 的草稿 → 頻道語言 C；回譯 C → U；比對用 U。預設 U = 台灣正體、C = 英文（原本的流程）。
 */

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
  /** 使用者用自己的語言（userLang）寫的草稿。 */
  draft: string;
  /** 最近的頻道訊息（會取最後 20 則）。 */
  recent: ContextMessage[];
  /** 使用者指定要回應的那則。 */
  replyTo?: ContextMessage;
  tone: ToneProfile;
  glossary?: GlossaryEntry[];
  /** 使用者自己過去在這個頻道用頻道語言寫過的訊息，讓結果像他。 */
  myVoice?: string[];
  /** 「再調整」：例如「短一點」「熱情一點」。 */
  instruction?: string;
  /** 使用者語言 U：草稿、「為什麼這樣寫」、回譯與比對都用它。預設台灣正體 */
  userLang?: Lang;
  /** 頻道語言 C：要送出的訊息用它。預設英文 */
  channelLang?: Lang;
  signal?: AbortSignal;
  onText?: (d: string) => void;
}

export const DEFAULT_USER_LANG: Lang = 'zh-TW';
export const DEFAULT_CHANNEL_LANG: Lang = 'en';

/** 保留語氣強弱的例子，依方向給（中文例子用台灣寫法，模型會換成該地區的字） */
function hedgeRule(u: Lang, c: Lang): string {
  if (u === c) return 'Keep hedges exactly as the draft has them; do not make them stronger or weaker.';
  if (isZh(u) && c === 'en') return 'Keep hedges at the same strength: 也許/可能 → maybe/might/could; 應該 → should/probably; 一定 → definitely. Do not turn "maybe" into "prob" or "definitely", or soften a firm statement.';
  if (u === 'en' && isZh(c)) return 'Keep hedges at the same strength: maybe/might/could → 也許/可能; probably/should → 應該/大概; definitely → 一定. Do not turn "maybe" into 應該 or 一定, or soften a firm statement into 好像.';
  return 'Keep hedges at the same strength (也許 stays 也許/也许, 一定 stays 一定); do not make them stronger or weaker.';
}

function nativeRules(c: Lang): string {
  if (c === 'en') {
    return `- Match the channel profile: capitalization, ending punctuation, message length, abbreviations, bursts.
- Avoid translationese: no em dashes, no "Great point!", no "Hope this helps", no "I also have the same situation", no over-politeness, no exclamation flooding, no stiff complete sentences where the channel writes fragments.`;
  }
  return `- Write in ${langInstruction(c, 8)}.
- Match the channel profile: punctuation habits (full-width ，。？！, half-width, or none at the end), sentence-final particles, message length, emoji, bursts.
- Avoid 翻譯腔 (translationese): no stacked 的, no needless 我們/你/他 subjects, no passive 被 where Chinese would use an active sentence, no English word order, no 希望這有幫助, no 親愛的 or 您好 in a casual channel, no exclamation flooding.
- Use the particles this channel uses (啦, 喔/哦, 欸, 吧, 耶, 哈哈…) only as often as the channel does. Keep English tech words and product names the way this channel writes them (many Chinese tech channels keep beta, build, PR, bug in English).`;
}

export const polishSystem = (u: Lang = DEFAULT_USER_LANG, c: Lang = DEFAULT_CHANNEL_LANG) => `You turn a draft written in ${langName(u)} by a member of a Slack channel into the ${langName(c)} messages they will send. ${
  u === c ? 'The draft is already in the channel\'s language: keep the user\'s words where they already sound natural here, and change only what makes it sound unlike this channel.' : ''
}They will read your output carefully before sending it under their own name, so it must say exactly what they meant, in the way people in this channel actually write.

Meaning
- Say everything in the draft and nothing more. Do not add facts, offers, promises ("will report back"), thanks, greetings, praise or opinions that are not in the draft.
- ${hedgeRule(u, c)}
- A question stays a question in every variant, even the casual one: if the user is asking for confirmation, the message must still read as asking.
- Resolve pronouns and omitted subjects from the conversation; if the user is replying to a message, the result must read as a reply to it.

Sounding native
${nativeRules(c)}
- Product names follow the glossary and the official capitalization (iOS 27.2, tvOS 27, Siri Remote, Find My).

Three variants (casual, channel, formal). Each one is an object { "bubbles": [strings], "merged": string or null, "notes": [{ "phrase", "why" }] }, never a plain string.
- casual: looser than the channel (shorter, more abbreviations or particles), still the same meaning.
- channel: what a regular in this channel would write. This is the default the user will most likely send.
- formal: complete sentences, normal capitalization and punctuation, usually one message; for editors or people the user does not know well.
- bubbles: split the way this channel splits messages (bursts of short messages are normal here); 1–3 bubbles. merged: the same content as a single message, or null if there is one bubble.
- notes: 2–4 per variant. phrase is a key phrase from that variant (or a short label for a style choice); why is one sentence in ${langInstruction(u, 6)}, explaining why it is written that way, so the user learns from it.`;
export const POLISH_SYSTEM = polishSystem();

export function buildPolishPrompt(input: PolishInput): string {
  const parts = [
    `Channel style profile:\n${describeToneProfile(input.tone)}`,
    input.myVoice?.length ? `Messages the user has written in this channel before (match their voice):\n${input.myVoice.map((t) => `> ${t}`).join('\n')}` : '',
    input.glossary?.length ? `Glossary:\n${formatGlossary(input.glossary, input.channelLang ?? DEFAULT_CHANNEL_LANG)}` : '',
    `Recent conversation (oldest first):\n${formatConversation(input.recent)}`,
    input.replyTo ? `The user is replying to:\n[${input.replyTo.user}] ${input.replyTo.text}` : '',
    `The user's draft (${langName(input.userLang ?? DEFAULT_USER_LANG)}):\n${input.draft}`,
    `Write the messages in ${langName(input.channelLang ?? DEFAULT_CHANNEL_LANG)}.`,
    input.instruction ? `Extra instruction from the user: ${input.instruction}` : '',
  ];
  return parts.filter(Boolean).join('\n\n');
}

export async function polish(llm: LLM, input: PolishInput): Promise<{ result: PolishResult; meta: TaskMeta }> {
  const { data, meta } = await runJson(llm, 'polish', 'polish', PolishOut, polishSystem(input.userLang, input.channelLang), buildPolishPrompt(input), { signal: input.signal, onText: input.onText });
  for (const t of TONES) {
    const v = data[t];
    v.bubbles = v.bubbles.map((b) => b.trim()).filter(Boolean);
    if (v.bubbles.length <= 1) v.merged = null;
  }
  return { result: data, meta };
}

const BackOut = z.strictObject({ items: z.array(z.strictObject({ key: z.string(), text: z.string() })) });

export interface BacktranslateInput {
  /** 要回譯的訊息（頻道語言），鍵自訂（例如 casual/channel/formal）。刻意沒有放使用者原稿的欄位。 */
  texts: Record<string, string>;
  /** 對話脈絡，幫助理解代名詞。 */
  recent?: ContextMessage[];
  /** 讓產品名的譯法和使用者原稿一致，比對時才不會把譯名差異當成意思差異。 */
  glossary?: GlossaryEntry[];
  /** 訊息的語言（頻道語言 C），預設英文 */
  from?: Lang;
  /** 回譯成的語言（使用者語言 U），預設台灣正體 */
  to?: Lang;
  signal?: AbortSignal;
}

function faithfulExample(from: Lang, to: Lang): string {
  if (from === 'en' && isZh(to)) return 'prob = 大概, maybe = 也許, definitely = 一定';
  if (isZh(from) && to === 'en') return '大概 = probably, 也許 = maybe, 應該 = should, 一定 = definitely';
  return '也許 stays 也許, 一定 stays 一定';
}

export const backtranslateSystem = (to: Lang = DEFAULT_USER_LANG, from: Lang = DEFAULT_CHANNEL_LANG) => `You translate ${langName(from)} Slack messages into ${langInstruction(to)}, so a reader can check exactly what the messages say.
- Be faithful, not nice: keep every added phrase, every hedge at its exact strength (${faithfulExample(from, to)}), every exclamation and the level of politeness.
- Do not fix, smooth over, or guess what the writer meant to say. If the original is odd, the translation should be odd in the same way.
- Natural word order is fine; dropping or adding meaning is not.
- Use the conversation only to understand pronouns and references. Never add names, places or details that the message itself does not say (if it says "the remote" or 遙控器, do not write Siri Remote).
- Follow the glossary for product names.`;

/** 獨立回譯：只給潤色結果，絕不給使用者原稿，否則模型會照抄原稿讓檢查失效。 */
export const BACKTRANSLATE_SYSTEM = backtranslateSystem();

export async function backtranslate(llm: LLM, input: BacktranslateInput): Promise<{ result: Record<string, string>; meta: TaskMeta }> {
  const keys = Object.keys(input.texts);
  const to = input.to ?? DEFAULT_USER_LANG;
  const user = [
    input.glossary?.length ? `Glossary:\n${formatGlossary(input.glossary, to)}` : '',
    input.recent?.length ? `Conversation for context (do not translate):\n${formatConversation(input.recent)}` : '',
    `Translate each item into ${langName(to)} (JSON):\n${JSON.stringify(keys.map((key) => ({ key, text: input.texts[key] })))}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const { data, meta } = await runJson(llm, 'backtranslate', 'backtranslation', BackOut, backtranslateSystem(to, input.from), user, { signal: input.signal });
  const result: Record<string, string> = {};
  for (const item of data.items) if (keys.includes(item.key)) result[item.key] = item.text;
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

const COMPARE_EXAMPLES: Record<'en' | 'zh', { shifts: string; summary: string; synonyms: string }> = {
  zh: {
    shifts: '也許 → 大概 is stronger; 一定 → 可能 is weaker',
    summary: '「也許」寫成了 prob（大概），語氣比你的原稿篤定一點 or 意思一致：沒有新增或漏掉資訊',
    synonyms: '細則 vs 小字說明, 升級 vs 更新, 晚點 vs 等一下, 精確尋找 vs Precision Finding',
  },
  en: {
    shifts: 'maybe → probably is stronger; definitely → might is weaker',
    summary: 'You wrote "maybe", but the message now says 應該 (probably), which sounds more certain than your draft. or Same meaning: nothing added or left out.',
    synonyms: 'update vs upgrade, later vs in a bit, fine print vs small print, Precision Finding vs 精確尋找',
  },
};

export const compareSystem = (u: Lang = DEFAULT_USER_LANG) => {
  const ex = COMPARE_EXAMPLES[u === 'en' ? 'en' : 'zh'];
  return `You check whether a message the user is about to send, seen through its back-translation into ${langName(u)}, still says what the user meant in their draft. The user may not be able to judge the message themselves; your verdict decides whether they feel safe pressing send.

Compare the draft with the back-translation and report:
- added: things the message says that the draft did not (new facts, promises such as "will report back", thanks, opinions).
- omitted: points in the draft that the message dropped.
- toneShifts: hedges or intensity that changed (${ex.shifts}), politeness or enthusiasm that changed noticeably.
- status: "warn" if anything was added, omitted or noticeably shifted that the user might not want; "info" if the only differences are harmless clarifications (spelling out "iOS", making an implied subject explicit, merging sentences); "ok" if the meaning matches.
- summary: one sentence in ${langInstruction(u, 6)}, that the user reads first, e.g. ${ex.summary}.
- highlights: the exact substrings of the back-translation where a difference shows, so the UI can mark them. Empty when status is ok.
- Write added, omitted and toneShifts in ${langName(u)} as well.
Not differences (do not list, do not highlight):
- word order, punctuation, capitalization, casual vs. formal register, unless they change what is being said;
- plain synonyms that come from the back-translator's word choice (${ex.synonyms}).
Making explicit something the conversation already establishes (the full product name, "iOS", which app the conversation is about) is "info", not "warn".`;
};

export interface CompareInput {
  /** 使用者原稿（使用者語言） */
  draft: string;
  /** 回譯（使用者語言） */
  backtranslation: string;
  /** 可選：給比對模型看要送出的訊息本身，能更準地判斷語氣。 */
  sent?: string;
  /** 對話脈絡：判斷「補上的資訊」是不是對話早已確立的。 */
  recent?: ContextMessage[];
  /** 使用者語言 U，摘要用它寫；預設台灣正體 */
  lang?: Lang;
  signal?: AbortSignal;
}

export const COMPARE_SYSTEM = compareSystem();

export async function compareMeaning(llm: LLM, input: CompareInput): Promise<{ result: MeaningCheck; meta: TaskMeta }> {
  const user = [
    input.recent?.length ? `Conversation so far:\n${formatConversation(input.recent)}` : '',
    `User's draft:\n${input.draft}`,
    input.sent ? `Message to be sent:\n${input.sent}` : '',
    `Back-translation of the message:\n${input.backtranslation}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const { data, meta } = await runJson(llm, 'compare', 'meaning_check', CompareOut, compareSystem(input.lang), user, { signal: input.signal });
  // 只保留真的出現在回譯裡的片段，介面才能安全地標黃。
  data.highlights = data.highlights.filter((h) => h && input.backtranslation.includes(h));
  if (data.status === 'ok') data.highlights = [];
  return { result: data, meta };
}

export interface ReviewVariant extends PolishVariant {
  /** 實際會送出的訊息（拆則時用換行連起來）。 */
  text: string;
  back: string;
  check: MeaningCheck;
}

export interface ReviewCard {
  draft: string;
  variants: Record<Tone, ReviewVariant>;
  meta: { polish: TaskMeta; backtranslate: TaskMeta | null; compare: TaskMeta[] };
}

/**
 * 完整審閱卡：polish → 三種語氣一次回譯 → 三個比對並行。
 * 使用者語言和頻道語言相同時不回譯（回譯就是訊息本身），直接拿去比對。
 */
export async function reviewDraft(llm: LLM, input: PolishInput): Promise<ReviewCard> {
  const u = input.userLang ?? DEFAULT_USER_LANG;
  const c = input.channelLang ?? DEFAULT_CHANNEL_LANG;
  const { result, meta: polishMeta } = await polish(llm, input);
  const sent = Object.fromEntries(TONES.map((t) => [t, result[t].bubbles.join('\n')])) as Record<Tone, string>;
  let back: Record<string, string> = sent;
  let backMeta: TaskMeta | null = null;
  if (u !== c) {
    const r = await backtranslate(llm, { texts: sent, recent: input.recent, glossary: input.glossary, from: c, to: u, signal: input.signal });
    back = r.result;
    backMeta = r.meta;
  }
  const checks = await Promise.all(
    TONES.map((t) => compareMeaning(llm, { draft: input.draft, backtranslation: back[t] ?? '', sent: sent[t], recent: input.recent, lang: u, signal: input.signal })),
  );
  const variants = Object.fromEntries(
    TONES.map((t, i) => [t, { ...result[t], text: sent[t], back: back[t] ?? '', check: checks[i].result }]),
  ) as Record<Tone, ReviewVariant>;
  return { draft: input.draft, variants, meta: { polish: polishMeta, backtranslate: backMeta, compare: checks.map((c) => c.meta) } };
}

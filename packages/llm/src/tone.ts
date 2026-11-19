/**
 * 頻道語氣檔案：用程式（不用模型）統計一批訊息的寫法，潤色時連同範例一起交給模型。
 * 全部是純函式，殼可以每天對最近 200 則重算一次。
 */

export interface ToneMessage {
  user: string;
  text: string;
  /** Unix 秒；有的話，連發判斷會要求與上一則相隔 5 分鐘內。 */
  ts?: number;
}

export interface ToneProfile {
  sampleSize: number;
  /** 開頭是英文字母的訊息中，小寫開頭的比例。 */
  lowercaseStartRatio: number;
  /** 句尾符號分布（比例，總和為 1）。 */
  endings: { none: number; period: number; question: number; exclamation: number; ellipsis: number };
  /** 常見縮寫與出現次數，多到少。 */
  abbreviations: Array<{ abbr: string; count: number }>;
  avgWords: number;
  avgChars: number;
  /** 屬於「同一人連發 ≥2 則」的訊息比例。 */
  burstRatio: number;
  /** 含 emoji 或 :shortcode: 的訊息比例。 */
  emojiRatio: number;
  /** 挑出來給模型看的真實訊息。 */
  examples: string[];
}

const BURST_GAP_SECONDS = 300;

/** 只認這張表裡的縮寫：統計要可預期，不猜。 */
export const KNOWN_ABBREVIATIONS = [
  'fwiw', 'tbh', 'imo', 'imho', 'prob', 'probs', 'btw', 'idk', 'afaik', 'iirc', 'ngl', 'rn', 'lol', 'lmao', 'omg',
  'ty', 'thx', 'pls', 'plz', 'np', 'jk', 'tbd', 'eta', 'fyi', 'asap', 'nvm', 'k', 'kk', 'gonna', 'wanna', 'gotta',
  'def', 'w/', 'w/o', 'b/c', 'bc', 'tho', 'thru', 'cuz', 'smth', 'sth',
] as const;

const EMOJI_RE = /\p{Extended_Pictographic}|:[a-z0-9_+-]+:/u;

/** 去掉不屬於「寫法」的部分：網址、提及、表情代碼、行首引用。 */
export function cleanForTone(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ') // Slack 的 <@U123>、<https://…|label>
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(^|\s)@[\w.-]+/g, ' ')
    .replace(/:[a-z0-9_+-]+:/g, ' ')
    .replace(/^>.*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ending(text: string): keyof ToneProfile['endings'] {
  const t = text.replace(/[\s)"'”’\p{Extended_Pictographic}]+$/u, '');
  if (/(\.\.\.|…)$/.test(t)) return 'ellipsis';
  const last = t.slice(-1);
  if (last === '.') return 'period';
  if (last === '?') return 'question';
  if (last === '!') return 'exclamation';
  return 'none';
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export function computeToneProfile(messages: ToneMessage[], opts: { maxExamples?: number } = {}): ToneProfile {
  const items = messages.map((m) => ({ ...m, clean: cleanForTone(m.text) })).filter((m) => m.clean.length > 0);
  const n = items.length;
  const ratio = (k: number, d = n) => (d === 0 ? 0 : round(k / d));

  let letterStarts = 0;
  let lowerStarts = 0;
  const endingCounts = { none: 0, period: 0, question: 0, exclamation: 0, ellipsis: 0 };
  const abbrCounts = new Map<string, number>();
  let totalWords = 0;
  let totalChars = 0;
  let emoji = 0;

  for (const m of items) {
    const first = m.clean[0];
    if (/[A-Za-z]/.test(first)) {
      letterStarts++;
      if (first === first.toLowerCase()) lowerStarts++;
    }
    endingCounts[ending(m.clean)]++;
    const ws = words(m.clean);
    totalWords += ws.length;
    totalChars += m.clean.length;
    for (const w of ws) {
      const token = w.toLowerCase().replace(/^[^a-z/]+|[^a-z/]+$/g, '');
      if ((KNOWN_ABBREVIATIONS as readonly string[]).includes(token)) abbrCounts.set(token, (abbrCounts.get(token) ?? 0) + 1);
    }
    if (EMOJI_RE.test(m.text)) emoji++;
  }

  // 連發：與前一則同一人（且在時間間隔內）就把兩則都標成連發。
  const inBurst = new Array(n).fill(false);
  for (let i = 1; i < n; i++) {
    const prev = items[i - 1];
    const cur = items[i];
    const close = prev.ts === undefined || cur.ts === undefined || cur.ts - prev.ts <= BURST_GAP_SECONDS;
    if (prev.user === cur.user && close) inBurst[i - 1] = inBurst[i] = true;
  }

  return {
    sampleSize: n,
    lowercaseStartRatio: ratio(lowerStarts, letterStarts),
    endings: {
      none: ratio(endingCounts.none),
      period: ratio(endingCounts.period),
      question: ratio(endingCounts.question),
      exclamation: ratio(endingCounts.exclamation),
      ellipsis: ratio(endingCounts.ellipsis),
    },
    abbreviations: [...abbrCounts].map(([abbr, count]) => ({ abbr, count })).sort((a, b) => b.count - a.count || a.abbr.localeCompare(b.abbr)),
    avgWords: n ? Math.round((totalWords / n) * 10) / 10 : 0,
    avgChars: n ? Math.round(totalChars / n) : 0,
    burstRatio: ratio(inBurst.filter(Boolean).length),
    emojiRatio: ratio(emoji),
    examples: pickExamples(items.map((m) => m.text.trim()), opts.maxExamples ?? 15),
  };
}

/** 從最新的往回挑：2–40 個字、不重複；太短（"yep"）的少量保留，因為那也是語氣。 */
function pickExamples(texts: string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let short = 0;
  for (let i = texts.length - 1; i >= 0 && out.length < max; i--) {
    const t = texts[i];
    const key = t.toLowerCase();
    const wc = words(t).length;
    if (seen.has(key) || wc > 40) continue;
    if (wc < 2) {
      if (short >= 2) continue;
      short++;
    }
    seen.add(key);
    out.push(t);
  }
  return out.reverse();
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** 寫進潤色提示的語氣描述（英文，給模型讀）。 */
export function describeToneProfile(p: ToneProfile): string {
  if (p.sampleSize === 0) return 'No channel history available.';
  const lines = [
    `Based on ${p.sampleSize} recent messages in this channel:`,
    `- ${pct(p.lowercaseStartRatio)} of messages start with a lowercase letter.`,
    `- Sentence endings: ${pct(p.endings.none)} no punctuation, ${pct(p.endings.period)} period, ${pct(p.endings.question)} question mark, ${pct(p.endings.exclamation)} exclamation, ${pct(p.endings.ellipsis)} ellipsis.`,
    `- Average length: ${p.avgWords} words per message.`,
    `- ${pct(p.burstRatio)} of messages are part of a burst (same person sending several short messages in a row).`,
    `- ${pct(p.emojiRatio)} of messages contain emoji.`,
  ];
  if (p.abbreviations.length) lines.push(`- Abbreviations people use here: ${p.abbreviations.slice(0, 8).map((a) => a.abbr).join(', ')}.`);
  if (p.examples.length) lines.push('', 'Real example messages from this channel:', ...p.examples.map((e) => `> ${e}`));
  return lines.join('\n');
}

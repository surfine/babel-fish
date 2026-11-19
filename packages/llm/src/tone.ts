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
  /** 以中文為主的訊息比例；≥ 0.5 時描述改用中文頻道的統計。 */
  zhRatio: number;
  /** 中文訊息的寫法；沒有中文訊息時為 null。 */
  zh: ZhToneStats | null;
}

/** 中文頻道的寫法統計（英文的小寫開頭、縮寫在中文裡沒有意義）。 */
export interface ZhToneStats {
  /** 中文訊息數 */
  sampleSize: number;
  /** 有句尾標點的中文訊息裡，用全形（。？！…～）的比例 */
  fullWidthEndingRatio: number;
  /** 中文訊息裡，句子之間用空格代替逗號、句號的比例（「好 我等等看」） */
  spaceAsPunctuationRatio: number;
  /** 句尾語氣詞與次數，多到少（固定詞表） */
  particles: Array<{ particle: string; count: number }>;
  /** 夾英文詞（beta、PR、bug…）的中文訊息比例 */
  codeSwitchRatio: number;
  /** 字形：繁體或簡體；分不出來時為 null */
  script: 'traditional' | 'simplified' | null;
  avgChars: number;
}

const BURST_GAP_SECONDS = 300;

/** 只認這張表裡的縮寫：統計要可預期，不猜。 */
export const KNOWN_ABBREVIATIONS = [
  'fwiw', 'tbh', 'imo', 'imho', 'prob', 'probs', 'btw', 'idk', 'afaik', 'iirc', 'ngl', 'rn', 'lol', 'lmao', 'omg',
  'ty', 'thx', 'pls', 'plz', 'np', 'jk', 'tbd', 'eta', 'fyi', 'asap', 'nvm', 'k', 'kk', 'gonna', 'wanna', 'gotta',
  'def', 'w/', 'w/o', 'b/c', 'bc', 'tho', 'thru', 'cuz', 'smth', 'sth',
] as const;

const EMOJI_RE = /\p{Extended_Pictographic}|:[a-z0-9_+-]+:/u;

/** 只認這張表裡的句尾語氣詞與聊天常見的笑聲，長的先比 */
export const KNOWN_PARTICLES = [
  '哈哈哈', '哈哈', 'XD', '啦', '喔', '哦', '噢', '呢', '吧', '嗎', '吗', '耶', '欸', '诶', '嗯', '啊', '呀', '唷', '囉', '啰', '喇', '咩', '嘛', '咧', '捏', '嘿',
] as const;

const LAUGHS = ['哈哈哈', '哈哈', 'XD'] as const;

// 繁簡各取一批最常見、只出現在一邊的字，用來判斷字形
const TRAD_ONLY = '這們個說會來時對為還沒開發過後問題點東現樣麼嗎讓給裡應該們經處實體當與從將過覺幫謝試學習關機寫讀錯電網'.split('');
const SIMP_ONLY = '这们个说会来时对为还没开发过后问题点东现样么吗让给里应该们经处实体当与从将过觉帮谢试学习关机写读错电网'.split('');

const HAN_RE = /[\u3400-\u9fff\uf900-\ufaff]/g;

/** 去掉網址等雜訊後，漢字數乘 3（約略等於字母數）超過拉丁字母數就算中文訊息 */
export function isMostlyChinese(clean: string): boolean {
  const han = clean.match(HAN_RE)?.length ?? 0;
  const latin = clean.match(/[A-Za-z]/g)?.length ?? 0;
  return han > 0 && han * 3 >= latin;
}

/** 依常見字判斷繁體或簡體；兩邊都沒有就回傳 null */
export function detectScript(text: string): 'traditional' | 'simplified' | null {
  let t = 0;
  let s = 0;
  for (const ch of text) {
    if (TRAD_ONLY.includes(ch)) t++;
    else if (SIMP_ONLY.includes(ch)) s++;
  }
  if (t === s) return null;
  return t > s ? 'traditional' : 'simplified';
}

function zhEnding(text: string): 'full' | 'half' | 'none' {
  const t = text.replace(/[\s)"'”’）」』\p{Extended_Pictographic}]+$/u, '');
  if (/[。？！…～]$/.test(t)) return 'full';
  if (/[.?!~]$/.test(t)) return 'half';
  return 'none';
}

function zhStats(texts: string[]): ZhToneStats | null {
  if (!texts.length) return null;
  let withEnding = 0;
  let full = 0;
  let spaced = 0;
  let codeSwitch = 0;
  let chars = 0;
  const particles = new Map<string, number>();
  for (const t of texts) {
    const e = zhEnding(t);
    if (e !== 'none') withEnding++;
    if (e === 'full') full++;
    if (/[\u3400-\u9fff] +[\u3400-\u9fff]/.test(t)) spaced++;
    if (/[A-Za-z]{2,}/.test(t)) codeSwitch++;
    chars += t.length;
    // 笑聲出現在哪裡都算；其他語氣詞只看每個子句的結尾（標點、空白、字串尾之前）
    const laugh = LAUGHS.find((l) => t.includes(l));
    if (laugh) particles.set(laugh, (particles.get(laugh) ?? 0) + 1);
    for (const clause of t.split(/[，。？！…～,.?!~\s]+/)) {
      const hit = KNOWN_PARTICLES.find((p) => !LAUGHS.includes(p as never) && clause.endsWith(p));
      if (hit) particles.set(hit, (particles.get(hit) ?? 0) + 1);
    }
  }
  const n = texts.length;
  return {
    sampleSize: n,
    fullWidthEndingRatio: withEnding ? round(full / withEnding) : 0,
    spaceAsPunctuationRatio: round(spaced / n),
    particles: [...particles].map(([particle, count]) => ({ particle, count })).sort((a, b) => b.count - a.count || a.particle.localeCompare(b.particle)),
    codeSwitchRatio: round(codeSwitch / n),
    script: detectScript(texts.join('')),
    avgChars: Math.round(chars / n),
  };
}

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
  const t = text.replace(/[\s)"'”’）」』\p{Extended_Pictographic}]+$/u, '');
  if (/(\.\.\.|…|⋯|。。)$/.test(t)) return 'ellipsis';
  const last = t.slice(-1);
  if (last === '.' || last === '。') return 'period';
  if (last === '?' || last === '？') return 'question';
  if (last === '!' || last === '！') return 'exclamation';
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

  const zhTexts = items.filter((m) => isMostlyChinese(m.clean)).map((m) => m.clean);

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
    zhRatio: ratio(zhTexts.length),
    zh: zhStats(zhTexts),
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
    // 中文沒有空格，約 2 個字當 1 個詞
    const wc = isMostlyChinese(t) ? Math.ceil((t.match(HAN_RE)?.length ?? 0) / 2) : words(t).length;
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

/** 寫進潤色提示的語氣描述（英文，給模型讀）。中文為主的頻道改用中文寫法的統計。 */
export function describeToneProfile(p: ToneProfile): string {
  if (p.sampleSize === 0) return 'No channel history available.';
  const examples = p.examples.length ? ['', 'Real example messages from this channel:', ...p.examples.map((e) => `> ${e}`)] : [];
  if (p.zh && p.zhRatio >= 0.5) {
    const z = p.zh;
    const lines = [
      `Based on ${p.sampleSize} recent messages in this channel (${pct(p.zhRatio)} written mainly in Chinese${z.script ? `, ${z.script} characters` : ''}):`,
      `- Of Chinese messages that end with punctuation, ${pct(z.fullWidthEndingRatio)} use full-width marks (。？！…～); the rest use half-width.`,
      `- ${pct(p.endings.none)} of all messages have no ending punctuation at all.`,
      `- ${pct(z.spaceAsPunctuationRatio)} of Chinese messages use spaces instead of commas or periods between clauses.`,
      `- Average length: ${z.avgChars} characters per Chinese message.`,
      `- ${pct(z.codeSwitchRatio)} of Chinese messages mix in English words (tech terms, product names).`,
      `- ${pct(p.burstRatio)} of messages are part of a burst (same person sending several short messages in a row).`,
      `- ${pct(p.emojiRatio)} of messages contain emoji.`,
    ];
    if (z.particles.length) lines.push(`- Sentence-final particles and laughs people use here: ${z.particles.slice(0, 8).map((x) => `${x.particle} (${x.count})`).join(', ')}.`);
    else lines.push('- People here rarely use sentence-final particles (啦, 喔, 吧…).');
    return [...lines, ...examples].join('\n');
  }
  const lines = [
    `Based on ${p.sampleSize} recent messages in this channel:`,
    `- ${pct(p.lowercaseStartRatio)} of messages start with a lowercase letter.`,
    `- Sentence endings: ${pct(p.endings.none)} no punctuation, ${pct(p.endings.period)} period, ${pct(p.endings.question)} question mark, ${pct(p.endings.exclamation)} exclamation, ${pct(p.endings.ellipsis)} ellipsis.`,
    `- Average length: ${p.avgWords} words per message.`,
    `- ${pct(p.burstRatio)} of messages are part of a burst (same person sending several short messages in a row).`,
    `- ${pct(p.emojiRatio)} of messages contain emoji.`,
  ];
  if (p.abbreviations.length) lines.push(`- Abbreviations people use here: ${p.abbreviations.slice(0, 8).map((a) => a.abbr).join(', ')}.`);
  return [...lines, ...examples].join('\n');
}

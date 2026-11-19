// Slack mrkdwn → 安全的 HTML 字串。
// Slack 送來的文字已把 & < > 轉成實體；未轉義的 <…> 一定是特殊標記（提及、連結、頻道、廣播）。
// 做法：先把文字切成「程式碼區塊／引用／一般行」，一般行再做 inline 標記；所有純文字最後才 HTML 跳脫。

export interface MrkdwnContext {
  userName?: (id: string) => string | undefined;
  channelName?: (id: string) => string | undefined;
  emoji?: (name: string) => { char?: string; url?: string } | undefined;
  selfId?: string;
  idioms?: string[]; // 要加點狀底線的片語（只在純文字段落裡找）
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const decodeEntities = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const SAFE_URL = /^(https?:|mailto:|slack:)/i;

type Seg = { html: string } | { text: string };

// <…> 特殊標記
function angle(inner: string, ctx: MrkdwnContext): Seg {
  const [target, label] = splitOnce(inner, '|');
  if (target.startsWith('@')) {
    const id = target.slice(1);
    const name = label || ctx.userName?.(id) || id;
    const self = id === ctx.selfId ? ' self' : '';
    return { html: `<span class="mention${self}" data-user="${escapeHtml(id)}">@${escapeHtml(decodeEntities(name))}</span>` };
  }
  if (target.startsWith('#')) {
    const id = target.slice(1);
    const name = label || ctx.channelName?.(id) || id;
    return { html: `<span class="mention channel" data-channel="${escapeHtml(id)}">#${escapeHtml(decodeEntities(name))}</span>` };
  }
  if (target.startsWith('!')) {
    const cmd = target.slice(1);
    if (cmd === 'here' || cmd === 'channel' || cmd === 'everyone') {
      return { html: `<span class="mention broadcast">@${cmd}</span>` };
    }
    if (cmd.startsWith('subteam^')) {
      return { html: `<span class="mention">${escapeHtml(decodeEntities(label || '@group'))}</span>` };
    }
    if (cmd.startsWith('date^')) {
      return { text: decodeEntities(label || '') };
    }
    return { text: decodeEntities(label || '') };
  }
  const url = decodeEntities(target);
  if (!SAFE_URL.test(url)) return { text: decodeEntities(label || target) };
  const shown = label ? decodeEntities(label) : url.replace(/^mailto:/i, '');
  return { html: `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(shown)}</a>` };
}

function splitOnce(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
}

// 粗體／斜體／刪除線：Slack 要求標記兩側是邊界、內側緊貼非空白
const STYLES: [string, string][] = [
  ['*', 'b'],
  ['_', 'i'],
  ['~', 's'],
];

function styleText(raw: string, ctx: MrkdwnContext): string {
  // raw 是已解碼的純文字；先做 emoji，再做字型樣式，最後跳脫
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    const style = STYLES.find(([m]) => m === ch);
    if (style && isOpenBoundary(raw, i)) {
      const close = findClose(raw, i + 1, ch);
      if (close > i + 1) {
        const inner = raw.slice(i + 1, close);
        out += `<${style[1]}>${styleText(inner, ctx)}</${style[1]}>`;
        i = close + 1;
        continue;
      }
    }
    if (ch === ':') {
      const m = /^:([a-z0-9_+'-]+):(?::skin-tone-([2-6]):)?/i.exec(raw.slice(i));
      if (m) {
        const e = ctx.emoji?.(m[2] ? `${m[1]}::skin-tone-${m[2]}` : m[1]);
        if (e?.char) {
          out += `<span class="emoji" title=":${escapeHtml(m[1])}:">${e.char}</span>`;
          i += m[0].length;
          continue;
        }
        if (e?.url) {
          out += `<img class="emoji" alt=":${escapeHtml(m[1])}:" src="${escapeHtml(e.url)}">`;
          i += m[0].length;
          continue;
        }
      }
    }
    // 一般文字：讀到下一個可能的標記為止
    let j = i + 1;
    while (j < raw.length && !'*_~:'.includes(raw[j])) j++;
    out += idiomize(raw.slice(i, j), ctx.idioms);
    i = j;
  }
  return out;
}

function isOpenBoundary(s: string, i: number) {
  const prev = i === 0 ? '' : s[i - 1];
  const next = s[i + 1] ?? '';
  return (prev === '' || /[\s([{"'*_~\u0000]/.test(prev)) && next !== '' && !/\s/.test(next);
}

function findClose(s: string, from: number, mark: string) {
  for (let k = from; k < s.length; k++) {
    if (s[k] === '\n') return -1;
    if (s[k] !== mark) continue;
    const before = s[k - 1];
    const after = s[k + 1] ?? '';
    if (!/\s/.test(before) && (after === '' || /[\s.,!?;:)\]}"'*_~\u0000]/.test(after))) return k;
  }
  return -1;
}

function idiomize(text: string, idioms?: string[]): string {
  if (!idioms?.length) return escapeHtml(text);
  // 長的先比，避免短片語吃掉長片語的一部分
  const sorted = [...idioms].sort((a, b) => b.length - a.length);
  const lower = text.toLowerCase();
  for (const phrase of sorted) {
    const at = lower.indexOf(phrase.toLowerCase());
    if (at < 0) continue;
    const before = text.slice(0, at);
    const hit = text.slice(at, at + phrase.length);
    const after = text.slice(at + phrase.length);
    const rest = idioms.filter((p) => p !== phrase);
    return (
      idiomize(before, rest) +
      `<span class="idiom" tabindex="0" data-idiom="${escapeHtml(phrase)}">${escapeHtml(hit)}</span>` +
      idiomize(after, rest)
    );
  }
  return escapeHtml(text);
}

function inline(line: string, ctx: MrkdwnContext): string {
  const segs: Seg[] = [];
  // 切出 <…> 與 `code`
  const re = /<([^<>\n]+)>|`([^`\n]+)`/g;
  let last = 0;
  for (let m; (m = re.exec(line)); ) {
    if (m.index > last) segs.push({ text: decodeEntities(line.slice(last, m.index)) });
    if (m[1] !== undefined) segs.push(angle(m[1], ctx));
    else segs.push({ html: `<code>${escapeHtml(decodeEntities(m[2]))}</code>` });
    last = m.index + m[0].length;
  }
  if (last < line.length) segs.push({ text: decodeEntities(line.slice(last)) });
  // 樣式標記可能跨過提及或連結（例如 *<@U1> 你好*），所以把 html 段落換成佔位字元，整句一起處理
  const holes: string[] = [];
  const joined = segs.map((s) => ('html' in s ? (holes.push(s.html), `\u0000${holes.length - 1}\u0000`) : s.text)).join('');
  return styleText(joined, ctx).replace(/\u0000(\d+)\u0000/g, (_, n) => holes[+n]);
}

export function renderMrkdwn(text: string, ctx: MrkdwnContext = {}): string {
  if (!text) return '';
  const out: string[] = [];
  const parts = text.split('```');
  // 沒有對應結尾的 ``` 當普通文字
  if (parts.length % 2 === 0) parts.push(parts.splice(-2).join('```'));
  parts.forEach((part, idx) => {
    if (idx % 2 === 1) {
      out.push(`<pre>${escapeHtml(decodeEntities(part.replace(/^\n/, '').replace(/\n$/, '')))}</pre>`);
      return;
    }
    let chunk = part;
    if (idx > 0) chunk = chunk.replace(/^\n/, '');
    if (idx < parts.length - 1) chunk = chunk.replace(/\n$/, '');
    if (!chunk) return;
    let quote: string[] = [];
    let plain: string[] = [];
    const flushPlain = () => {
      if (plain.length) out.push(plain.map((l) => inline(l, ctx)).join('<br>'));
      plain = [];
    };
    const flushQuote = () => {
      if (quote.length) out.push(`<blockquote>${quote.map((l) => inline(l, ctx)).join('<br>')}</blockquote>`);
      quote = [];
    };
    for (const l of chunk.split('\n')) {
      const q = /^(?:&gt;|>) ?(.*)$/.exec(l);
      if (q) {
        flushPlain();
        quote.push(q[1]);
      } else {
        flushQuote();
        plain.push(l);
      }
    }
    flushPlain();
    flushQuote();
  });
  return out.join('');
}

// 給翻譯用的純文字：提及換成名字、連結換成顯示文字、實體解碼，保留換行。
export function mrkdwnToPlain(text: string, ctx: MrkdwnContext = {}): string {
  return decodeEntities(
    text.replace(/<([^<>\n]+)>/g, (_, inner: string) => {
      const [target, label] = splitOnce(inner, '|');
      if (target.startsWith('@')) return '@' + (label || ctx.userName?.(target.slice(1)) || target.slice(1));
      if (target.startsWith('#')) return '#' + (label || ctx.channelName?.(target.slice(1)) || target.slice(1));
      if (target.startsWith('!')) {
        const cmd = target.slice(1);
        return ['here', 'channel', 'everyone'].includes(cmd) ? '@' + cmd : label;
      }
      return label || target;
    }),
  );
}

// 把使用者寫的純文字轉成 Slack 要的格式：跳脫 & < >，@名字 不自動轉成提及（避免誤 ping）。
export function plainToMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function mentionsUser(text: string, userId: string): boolean {
  return text.includes(`<@${userId}>`) || text.includes(`<@${userId}|`) || /<!(here|channel|everyone)>/.test(text);
}

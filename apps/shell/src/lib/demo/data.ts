// 示範資料：虛構的 workspace、人名與對話，加上預寫的潤色範例。只在「示範模式」用，不會送到 Slack。
import type { Conversation, Message, Reaction, SlackFile, Team, User } from '../slack/types';
import type { CheckKind, Idiom, Tone } from '../translate/types';
import { mrkdwnToPlain } from '../mrkdwn';

export const DEMO_TEAM: Team = { id: 'T0DEMO', name: 'Tidewater Tech', url: 'https://tidewater-demo.slack.com/' };

// 虛構的科技新聞編輯部，人名與對話都是編的
export const DEMO_USERS: User[] = [
  { id: 'U01ME', name: 'mei', real_name: 'Mei Lin', color: '0f766e', is_bot: false },
  { id: 'U01OWEN', name: 'owen', real_name: 'Owen Park', color: 'b45309', is_bot: false },
  { id: 'U01DANA', name: 'dana', real_name: 'Dana Brooks', color: '6d28d9', is_bot: false },
  { id: 'U01RITA', name: 'rita', real_name: 'Rita Alvarez', color: 'be185d', is_bot: false },
  { id: 'U01SAM', name: 'sam', real_name: 'Sam Keller', color: '1d4ed8', is_bot: false },
];
export const DEMO_SELF = DEMO_USERS[0];

export const DEMO_CONVERSATIONS: Conversation[] = [
  { id: 'C0NEWS', name: 'newsroom', kind: 'private', is_member: true, unread: 0, mentions: 0, member_count: 14 },
  { id: 'C0GENERAL', name: 'general', kind: 'channel', is_member: true, unread: 2, mentions: 0, member_count: 41 },
  { id: 'D0DANA', name: 'U01DANA', kind: 'im', user_id: 'U01DANA', is_member: true, unread: 1, mentions: 1 },
  { id: 'D0OWEN', name: 'U01OWEN', kind: 'im', user_id: 'U01OWEN', is_member: true, unread: 0, mentions: 0 },
  { id: 'D0RITA', name: 'U01RITA', kind: 'im', user_id: 'U01RITA', is_member: true, unread: 0, mentions: 0 },
  { id: 'D0SAM', name: 'U01SAM', kind: 'im', user_id: 'U01SAM', is_member: true, unread: 0, mentions: 0 },
];

const ts = (d: number, h: number, m: number, s = 0) => String(new Date(2026, 9, d, h, m, s).getTime() / 1000) + '.000100';

const FIND_MY_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300">
<rect width="480" height="300" rx="18" fill="#f2f2f7"/>
<text x="24" y="44" font-family="-apple-system,Helvetica" font-size="22" font-weight="700" fill="#1c1c1e">Devices</text>
${['Owen’s iPad Pro', 'Office MacBook Pro', 'Kitchen HomePod mini', 'Owen’s Apple Watch']
  .map(
    (n, i) => `<rect x="16" y="${64 + i * 56}" width="448" height="48" rx="10" fill="#fff"/>
<circle cx="44" cy="${88 + i * 56}" r="14" fill="${['#34c759', '#0a84ff', '#8e8e93', '#ff9f0a'][i]}"/>
<text x="70" y="${93 + i * 56}" font-family="-apple-system,Helvetica" font-size="16" fill="#1c1c1e">${n}</text>`,
  )
  .join('')}
</svg>`);

const file = (f: Partial<SlackFile> & { id: string; name: string }): SlackFile => ({
  title: f.name,
  mimetype: null,
  filetype: null,
  size: null,
  url_private: null,
  thumb: null,
  thumb_w: null,
  thumb_h: null,
  permalink: null,
  ...f,
});

type DemoMsg = Partial<Message> & { ts: string; user: string; text: string; zh: string; idioms?: Idiom[] };

const r = (name: string, users: string[]): Reaction => ({ name, count: users.length, users, me: users.includes('U01ME') });

const IDIOM = {
  sureDoes: { phrase: 'sure does', meaning: '加強語氣：「還真的是…」', usage: '常用來附和或感嘆，例：it sure does take a while.' },
  ahK: { phrase: 'ah k', meaning: '= ah okay，極短的「喔好」', usage: '很隨意，熟人之間才這樣打。' },
  finePrint: { phrase: 'fine print', meaning: '合約、公告底下的小字細則', usage: 'support doc fine print＝支援文件裡的細則說明。' },
  fwiw: { phrase: 'fwiw', meaning: '= for what it’s worth，「僅供參考／順帶一提」', usage: '低調地補充資訊時用。' },
  esque: { phrase: 'Find My-esque', meaning: '-esque 字尾，「有點像…的」', usage: 'Find My-esque＝有點像「尋找」App 的。' },
  streamlined: { phrase: 'streamlined', meaning: 'streamline：把流程理順、拿掉多餘步驟', usage: '常用來稱讚改版：glad they streamlined this.' },
  goodCatch: { phrase: 'good catch', meaning: '「眼尖／抓得好」', usage: '別人指出你漏掉的細節時用來道謝。' },
} satisfies Record<string, Idiom>;

const NEWSROOM: DemoMsg[] = [
  { ts: ts(26, 17, 2), user: 'U01SAM', text: 'did the beta 4 build get pulled for anyone else?', zh: '你們那邊 beta 4 也被下架了嗎？' },
  { ts: ts(26, 17, 4), user: 'U01RITA', text: 'yep, gone from the developer site since this morning', zh: '對，今天早上起開發者網站上就沒了', reactions: [r('eyes', ['U01SAM', 'U01OWEN'])] },
  {
    ts: ts(26, 17, 9), user: 'U01OWEN', text: "screenshot from my iPad, the AirPods aren't listed at all",
    zh: '我 iPad 上的截圖，AirPods 完全沒列出來',
    files: [
      file({ id: 'F0IMG', name: 'find-my-ipad.png', mimetype: 'image/png', filetype: 'png', size: 182_340, thumb: FIND_MY_SVG, url_private: FIND_MY_SVG, thumb_w: 480, thumb_h: 300 }),
      file({ id: 'F0PDF', name: 'iPadOS-27-beta-4-notes.pdf', title: 'iPadOS 27 beta 4 notes', mimetype: 'application/pdf', filetype: 'pdf', size: 1_240_000 }),
    ],
  },
  { ts: ts(27, 7, 56), user: 'U01OWEN', text: 'sure does take forever to Verify', zh: '「驗證」這一步還真的有夠久', idioms: [IDIOM.sureDoes] },
  {
    ts: ts(27, 7, 57), user: 'U01OWEN',
    text: 'Oh good, iPadOS 27 drops the 8th gen iPad anyway so that one’s off the test list',
    zh: '喔不錯，反正 iPadOS 27 不支援第八代 iPad，那台就不用測了',
  },
  { ts: ts(27, 7, 59), user: 'U01OWEN', text: 'ok it’s updating now', zh: '好，現在在更新了' },
  {
    ts: ts(27, 8, 1), user: 'U01OWEN', text: '<@U01DANA> like we thought, my AirPods Pro still aren’t in the find my app on iPadOS 27 beta 4',
    zh: '@dana 跟我們想的一樣，升到 iPadOS 27 beta 4 後，我的 AirPods Pro 還是沒出現在「尋找」App 裡',
  },
  { ts: ts(27, 8, 7), user: 'U01DANA', text: 'ah k', zh: '喔，好', idioms: [IDIOM.ahK] },
  {
    ts: ts(27, 8, 7, 20), user: 'U01OWEN',
    text: 'support doc fine print fwiw\n&gt; Find My for AirPods requires AirPods Pro (2nd generation) or later. Precision Finding requires an iPhone with Ultra Wideband running the latest iOS software',
    zh: '順手附上支援文件的細則，供參考\n> AirPods 的「尋找」功能需要 AirPods Pro（第二代）或後續機型。「精確尋找」需要配備超寬頻、執行最新版 iOS 的 iPhone。',
    idioms: [IDIOM.finePrint, IDIOM.fwiw],
    reactions: [r('eyes', ['U01DANA'])],
    reply_count: 2, reply_users: ['U01DANA', 'U01RITA'], latest_reply: ts(27, 8, 11),
  },
  { ts: ts(27, 8, 7, 40), user: 'U01DANA', text: 'yep', zh: '對' },
  { ts: ts(27, 8, 7, 50), user: 'U01DANA', text: 'find my = the find my app, not the widget!', zh: 'find my 是指「尋找」App，不是小工具！' },
  {
    ts: ts(27, 8, 8), user: 'U01OWEN',
    text: 'yeah i think the confusion was that weird Find My-esque tile in Control Center... glad they streamlined this',
    zh: '對啊，我想之前會搞混，是因為控制中心裡那個有點像「尋找」的怪方塊……很高興他們把這塊理順了',
    idioms: [IDIOM.esque, IDIOM.streamlined],
    reactions: [r('+1', ['U01DANA', 'U01RITA']), r('100', ['U01SAM'])],
  },
];

const THREAD_ROOT = NEWSROOM.find((m) => m.reply_count)!.ts;
const THREAD: DemoMsg[] = [
  { ts: ts(27, 8, 9), user: 'U01DANA', thread_ts: THREAD_ROOT, text: 'oh so precision finding is iPhone only', zh: '喔，所以「精確尋找」只有 iPhone 能用' },
  {
    ts: ts(27, 8, 11), user: 'U01RITA', thread_ts: THREAD_ROOT, text: '*good catch* — let’s mention that in the explainer',
    zh: '抓得好，說明文裡要提一下', idioms: [IDIOM.goodCatch], reactions: [r('white_check_mark', ['U01DANA'])],
  },
];

const GENERAL: DemoMsg[] = [
  { ts: ts(27, 9, 12), user: 'U01SAM', text: 'reminder: <!here> standup moved to 10:30 today', zh: '提醒：@here 今天站會改到 10:30' },
  { ts: ts(27, 9, 14), user: 'U01RITA', text: 'ty! see everyone then :wave:', zh: '謝啦！到時見 👋' },
];

const DM_DANA: DemoMsg[] = [
  { ts: ts(27, 8, 20), user: 'U01DANA', text: 'hey <@U01ME> could you look over the iPadOS 27 device list before it goes live?', zh: '嘿 @mei，上線前可以幫忙看一下 iPadOS 27 的支援機型清單嗎？' },
];
const DM_OWEN: DemoMsg[] = [{ ts: ts(26, 18, 30), user: 'U01OWEN', text: 'thanks for the screenshots earlier!', zh: '謝謝你稍早的截圖！' }];

const toMessage = (m: DemoMsg): Message => ({
  subtype: null,
  thread_ts: m.reply_count ? m.ts : m.thread_ts ?? null,
  reply_count: 0,
  reply_users: [],
  latest_reply: null,
  edited: false,
  reactions: [],
  files: [],
  bot_name: null,
  ...m,
});

export const DEMO_HISTORY: Record<string, Message[]> = {
  C0NEWS: NEWSROOM.map(toMessage),
  C0GENERAL: GENERAL.map(toMessage),
  D0DANA: DM_DANA.map(toMessage),
  D0OWEN: DM_OWEN.map(toMessage),
  D0RITA: [],
  D0SAM: [],
};
export const DEMO_THREADS: Record<string, Message[]> = { [THREAD_ROOT]: THREAD.map(toMessage) };

// 譯文表：以「轉成純文字後的原文」為鍵，FakeTranslator 用它回傳設計稿的譯文
const nameOf = (id: string) => DEMO_USERS.find((u) => u.id === id)?.name;
export const DEMO_TRANSLATIONS: Record<string, { zh: string; idioms?: Idiom[] }> = Object.fromEntries(
  [...NEWSROOM, ...THREAD, ...GENERAL, ...DM_DANA, ...DM_OWEN].map((m) => [
    mrkdwnToPlain(m.text, { userName: nameOf }).trim(),
    { zh: m.zh, idioms: m.idioms },
  ]),
);

// 示範模式稍後送進來的一則私訊，用來看通知與未讀
export const DEMO_INCOMING = {
  channel: 'D0DANA',
  message: toMessage({ ts: '', user: 'U01DANA', text: 'also fwiw the iPad mini 5 is off the iPadOS 27 list :sweat_smile:', zh: '' }),
  zh: '另外順帶一提，iPadOS 27 不支援 iPad mini 5 了 😅',
};
DEMO_TRANSLATIONS[mrkdwnToPlain(DEMO_INCOMING.message.text)] = { zh: DEMO_INCOMING.zh, idioms: [IDIOM.fwiw] };

// ---------- 潤色範例 ----------
export const SAMPLE_DRAFT = '我這邊也一樣，beta 4 上看不到 AirPods。也許要等 iPad 重開機後才會出現？我等一下再試試';

type Variant = { bubbles: string[]; merged: string | null; back: string; check: [CheckKind, string]; notes: [string, string][] };

export const SAMPLE_VARIANTS: Record<Tone | 'short' | 'warm', Variant> = {
  casual: {
    bubbles: ['yep same, nothing on beta 4 here either', 'prob need to restart the iPad first. will check again later'],
    merged: 'yep same, nothing on beta 4 here either. prob need to restart the iPad first, will check again later',
    back: '對啊我也是，beta 4 這邊也什麼都沒有。<mark>大概</mark>要先把 iPad 重開機吧，我晚點再看看。',
    check: ['warn', '「也許」寫成了 prob（大概），語氣比你的原稿篤定一點'],
    notes: [['yep same', '比 same here 更隨意，適合跟熟的同事'], ['prob', 'probably 的縮寫，這個頻道很常見'], ['will check again later', '省略主詞 I，口語訊息很常這樣寫']],
  },
  natural: {
    bubbles: ['same here, no AirPods showing up on beta 4 for me either', 'maybe they only show up after the iPad restarts? will try again in a bit'],
    merged: 'same here, no AirPods showing up on beta 4 for me either. maybe they only show up after the iPad restarts? will try again in a bit',
    back: '我這邊也一樣，beta 4 上也沒看到 AirPods。也許要等 iPad 重開機後才會出現？我等一下再試試。',
    check: ['ok', '意思一致：沒有新增或漏掉資訊'],
    notes: [
      ['same here', '「我這邊也一樣」。Slack 上最自然的附和，比 I have the same situation 道地得多'],
      ['no AirPods showing up', '用 show up 表示「出現在清單裡」，也呼應 Owen 剛說的 still aren’t in'],
      ['小寫開頭、句尾不加句號', '跟這個頻道大多數訊息一致；在這裡正式大寫反而顯得生分'],
      ['in a bit', '「等一下」，比 later 更近、更口語'],
    ],
  },
  formal: {
    bubbles: ['Same here. I’m not seeing any AirPods on iPadOS 27 beta 4 either. They may only appear after the iPad restarts, so I’ll try again shortly.'],
    merged: null,
    back: '我這邊也一樣，在 <mark>iPadOS 27</mark> beta 4 上也看不到任何 AirPods。可能要等 iPad 重開機後才會出現，我稍後再試一次。',
    check: ['info', '補上了「iPadOS 27」讓版本號更清楚，其餘意思一致'],
    notes: [['完整句子、正常大小寫', '適合寫給編輯，或還不熟的人'], ['I’m not seeing', '進行式比 I don’t see 委婉，帶「目前看起來」的意思'], ['合併成一則', '正式一點的訊息通常不連發']],
  },
  short: {
    bubbles: ['same, nothing on beta 4 for me either', 'prob needs an iPad restart first. will retry in a bit'],
    merged: 'same, nothing on beta 4 for me either. prob needs an iPad restart first, will retry in a bit',
    back: '一樣，我 beta 4 上也沒有。<mark>大概</mark>要先重開 iPad，我等等再試。',
    check: ['warn', '「也許」寫成了 prob（大概），語氣比你的原稿篤定一點'],
    notes: [['刪掉可省略的字', 'here、showing up 都拿掉了，意思不變'], ['retry', '比 try again 短，技術討論裡很常見']],
  },
  warm: {
    bubbles: ['same here!! no AirPods showing up on beta 4 for me either', 'maybe they only show up after the iPad restarts? will try again in a bit and report back'],
    merged: 'same here!! no AirPods showing up on beta 4 for me either. maybe they only show up after the iPad restarts? will try again in a bit and report back',
    back: '我這邊也一樣！！beta 4 上也沒看到 AirPods。也許要等 iPad 重開機後才會出現？我等一下再試，<mark>有結果再回報</mark>。',
    check: ['warn', '多了一句「有結果再回報」（report back），你的原稿沒有這句'],
    notes: [['!!', '兩個驚嘆號讓語氣更熱絡，這個頻道偶爾會這樣用'], ['report back', '「回報結果」。這句是模型加的，不需要就直接刪掉']],
  },
};

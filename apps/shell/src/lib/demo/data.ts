// 示範資料：虛構的 workspace、人名與對話，加上預寫的潤色範例。只在「示範模式」用，不會送到 Slack。
import type { Conversation, Message, Reaction, SlackFile, Team, User } from '../slack/types';
import type { CheckKind, Idiom, Tone } from '../translate/types';
import { mrkdwnToPlain } from '../mrkdwn';

export const DEMO_TEAM: Team = { id: 'T0DEMO', name: 'Harbor Cycles', url: 'https://harbor-demo.slack.com/' };

// 虛構的自行車品牌：美國的產品團隊和台中的工廠團隊。人名、公司與對話都是編的
export const DEMO_USERS: User[] = [
  { id: 'U01ME', name: 'mei', real_name: 'Mei Lin', color: '0f766e', is_bot: false },
  { id: 'U01OWEN', name: 'owen', real_name: 'Owen Park', color: 'b45309', is_bot: false },
  { id: 'U01DANA', name: 'dana', real_name: 'Dana Brooks', color: '6d28d9', is_bot: false },
  { id: 'U01RITA', name: 'rita', real_name: 'Rita Alvarez', color: 'be185d', is_bot: false },
  { id: 'U01SAM', name: 'sam', real_name: 'Sam Keller', color: '1d4ed8', is_bot: false },
  // 台中工廠（同樣是虛構的人）
  { id: 'U01JIA', name: 'jiahao', real_name: '張家豪', color: '0e7490', is_bot: false },
  { id: 'U01YI', name: 'yijun', real_name: '陳怡君', color: 'a16207', is_bot: false },
];
export const DEMO_SELF = DEMO_USERS[0];

export const DEMO_CONVERSATIONS: Conversation[] = [
  { id: 'C0NEWS', name: 'product', kind: 'private', is_member: true, unread: 0, mentions: 0, member_count: 14 },
  { id: 'C0GENERAL', name: 'general', kind: 'channel', is_member: true, unread: 2, mentions: 0, member_count: 41 },
  { id: 'C0TAIPEI', name: 'taichung-team', kind: 'channel', is_member: true, unread: 0, mentions: 0, member_count: 9 },
  { id: 'D0DANA', name: 'U01DANA', kind: 'im', user_id: 'U01DANA', is_member: true, unread: 1, mentions: 1 },
  { id: 'D0OWEN', name: 'U01OWEN', kind: 'im', user_id: 'U01OWEN', is_member: true, unread: 0, mentions: 0 },
  { id: 'D0RITA', name: 'U01RITA', kind: 'im', user_id: 'U01RITA', is_member: true, unread: 0, mentions: 0 },
  { id: 'D0SAM', name: 'U01SAM', kind: 'im', user_id: 'U01SAM', is_member: true, unread: 0, mentions: 0 },
];

const ts = (d: number, h: number, m: number, s = 0) => String(new Date(2026, 9, d, h, m, s).getTime() / 1000) + '.000100';

// 樣品照片：車架樣品和色卡並排，樣品的綠色比較深
const SAMPLE_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300">
<rect width="480" height="300" rx="18" fill="#e9e6df"/>
<rect x="32" y="40" width="196" height="196" rx="12" fill="#24503b"/>
<rect x="252" y="40" width="196" height="196" rx="12" fill="#3f7f5c"/>
<text x="130" y="270" text-anchor="middle" font-family="-apple-system,Helvetica" font-size="17" fill="#1c1c1e">Frame sample</text>
<text x="350" y="270" text-anchor="middle" font-family="-apple-system,Helvetica" font-size="17" fill="#1c1c1e">Swatch</text>
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

// zh：英文訊息給中文使用者的譯文；en：中文訊息給英文使用者的譯文
type DemoMsg = Partial<Message> & { ts: string; user: string; text: string; zh?: string; idioms?: Idiom[]; en?: string; enIdioms?: Idiom[] };

const r = (name: string, users: string[]): Reaction => ({ name, count: users.length, users, me: users.includes('U01ME') });

const IDIOM = {
  sureDoes: { phrase: 'sure does', meaning: '加強語氣：「還真的是…」', usage: '常用來附和或感嘆，例：it sure does take a while.' },
  ahK: { phrase: 'ah k', meaning: '= ah okay，極短的「喔好」', usage: '很隨意，熟人之間才這樣打。' },
  finePrint: { phrase: 'fine print', meaning: '合約、文件底下的小字細則', usage: 'spec sheet fine print＝規格書裡的細則。' },
  fwiw: { phrase: 'fwiw', meaning: '= for what it’s worth，「僅供參考／順帶一提」', usage: '低調地補充資訊時用。' },
  esque: { phrase: 'lightbox-esque', meaning: '-esque 字尾，「有點像…的」', usage: 'lightbox-esque＝有點像燈箱的。' },
  streamlined: { phrase: 'streamlined', meaning: 'streamline：把流程理順、拿掉多餘步驟', usage: '常用來稱讚改版：glad they streamlined this.' },
  goodCatch: { phrase: 'good catch', meaning: '「眼尖／抓得好」', usage: '別人指出你漏掉的細節時用來道謝。' },
} satisfies Record<string, Idiom>;

const NEWSROOM: DemoMsg[] = [
  { ts: ts(26, 17, 2), user: 'U01SAM', text: 'did the frame samples from Taichung arrive yet?', zh: '台中寄的車架樣品到了嗎？' },
  { ts: ts(26, 17, 4), user: 'U01RITA', text: 'yep, landed at the office this morning', zh: '到了，今天早上送到辦公室', reactions: [r('eyes', ['U01SAM', 'U01OWEN'])] },
  {
    ts: ts(26, 17, 9), user: 'U01OWEN', text: 'photo of the sample next to the swatch, the green is way darker',
    zh: '樣品和色卡放在一起拍的，綠色深很多',
    files: [
      file({ id: 'F0IMG', name: 'sample-vs-swatch.png', mimetype: 'image/png', filetype: 'png', size: 182_340, thumb: SAMPLE_SVG, url_private: SAMPLE_SVG, thumb_w: 480, thumb_h: 300 }),
      file({ id: 'F0PDF', name: 'frame-spec-rev-c.pdf', title: 'Frame spec rev C', mimetype: 'application/pdf', filetype: 'pdf', size: 1_240_000 }),
    ],
  },
  { ts: ts(27, 7, 56), user: 'U01OWEN', text: 'sure does take forever to clear customs', zh: '清關還真的有夠久', idioms: [IDIOM.sureDoes] },
  {
    ts: ts(27, 7, 57), user: 'U01OWEN',
    text: 'Oh good, we’re dropping the 52cm size anyway so that one’s off the test list',
    zh: '喔不錯，反正 52 公分的尺寸要停掉了，那支就不用測了',
  },
  { ts: ts(27, 7, 59), user: 'U01OWEN', text: 'ok assembling it now', zh: '好，現在在組裝了' },
  {
    ts: ts(27, 8, 1), user: 'U01OWEN', text: '<@U01DANA> like we thought, the green on the sample still doesn’t match the swatch in daylight',
    zh: '@dana 跟我們想的一樣，在日光下，樣品的綠色還是跟色卡對不上',
  },
  { ts: ts(27, 8, 7), user: 'U01DANA', text: 'ah k', zh: '喔，好', idioms: [IDIOM.ahK] },
  {
    ts: ts(27, 8, 7, 20), user: 'U01OWEN',
    text: 'spec sheet fine print fwiw\n&gt; Color must be within ΔE 2.0 of the approved swatch, measured under D65 light. Samples outside tolerance are remade at the supplier’s cost.',
    zh: '順手附上規格書的細則，供參考\n> 顏色與核可色卡的差異須在 ΔE 2.0 以內，以 D65 光源量測。超出誤差的樣品由供應商負擔費用重做。',
    idioms: [IDIOM.finePrint, IDIOM.fwiw],
    reactions: [r('eyes', ['U01DANA'])],
    reply_count: 2, reply_users: ['U01DANA', 'U01RITA'], latest_reply: ts(27, 8, 11),
  },
  { ts: ts(27, 8, 7, 40), user: 'U01DANA', text: 'yep', zh: '對' },
  { ts: ts(27, 8, 7, 50), user: 'U01DANA', text: 'daylight = the D65 lamp, not the window!', zh: '日光是指 D65 燈，不是窗邊！' },
  {
    ts: ts(27, 8, 8), user: 'U01OWEN',
    text: 'yeah i think the confusion was that weird lightbox-esque thing in the old studio... glad they streamlined this',
    zh: '對啊，我想之前會搞混，是因為舊工作室那個有點像燈箱的怪東西……很高興他們把這塊理順了',
    idioms: [IDIOM.esque, IDIOM.streamlined],
    reactions: [r('+1', ['U01DANA', 'U01RITA']), r('100', ['U01SAM'])],
  },
];

const THREAD_ROOT = NEWSROOM.find((m) => m.reply_count)!.ts;
const THREAD: DemoMsg[] = [
  { ts: ts(27, 8, 9), user: 'U01DANA', thread_ts: THREAD_ROOT, text: 'oh so the tolerance only counts under D65', zh: '喔，所以誤差只看 D65 光源下的結果' },
  {
    ts: ts(27, 8, 11), user: 'U01RITA', thread_ts: THREAD_ROOT, text: '*good catch* — let’s put that in the factory brief',
    zh: '抓得好，給工廠的說明裡要寫進去', idioms: [IDIOM.goodCatch], reactions: [r('white_check_mark', ['U01DANA'])],
  },
];

// 示範用的連結預覽（虛構網站）；圖用 data URL，不連外
const PREVIEW_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="300" viewBox="0 0 640 300"><rect width="640" height="300" fill="#24503b"/><text x="40" y="170" font-family="-apple-system,Helvetica" font-size="44" font-weight="700" fill="#f4efe4">Color standard rev D</text></svg>`);
NEWSROOM.push({
  ts: ts(27, 8, 12), user: 'U01SAM',
  text: 'new color standard is up <https://docs.example.com/harbor/color-standard>',
  zh: '新版顏色標準出來了',
  previews: [{ url: 'https://docs.example.com/harbor/color-standard', title: 'Harbor Cycles color standard, rev D', text: 'Paint samples are now checked in a D65 lightbox. The tolerance stays at ΔE 2.0.', image: PREVIEW_SVG, image_w: 640, image_h: 300, service: 'Example Docs' }],
});

const GENERAL: DemoMsg[] = [
  { ts: ts(27, 9, 12), user: 'U01SAM', text: 'reminder: <!here> standup moved to 10:30 today', zh: '提醒：@here 今天站會改到 10:30' },
  { ts: ts(27, 9, 14), user: 'U01RITA', text: 'ty! see everyone then :wave:', zh: '謝啦！到時見 👋' },
];

// 中文頻道：英文使用者看的是預寫的英文譯文
const SLANG = {
  stunned: { phrase: '傻眼', meaning: 'stunned, speechless', usage: 'Taiwanese slang for being so surprised or let down that you have nothing to say.' },
  again: { phrase: '又來', meaning: '"here we go again"', usage: 'Said with a sigh when a known problem shows up one more time.' },
  stuck: { phrase: '卡關', meaning: 'stuck, blocked', usage: 'From video games (stuck on a level); at work it means a task cannot move forward.' },
  la: { phrase: '啦', meaning: 'softening particle', usage: 'Makes a suggestion sound relaxed rather than pushy, like "I mean, …".' },
} satisfies Record<string, Idiom>;

const TAIPEI: DemoMsg[] = [
  { ts: ts(27, 10, 2), user: 'U01JIA', text: '第二批車架剛烤完漆', en: 'The second batch of frames just finished painting' },
  { ts: ts(27, 10, 3), user: 'U01JIA', text: '綠色還是偏深，我傻眼', en: 'The green is still too dark. I’m speechless', enIdioms: [SLANG.stunned] },
  { ts: ts(27, 10, 6), user: 'U01YI', text: '又來 這個色差卡關兩週了吧', en: 'Not again. This color mismatch has had us stuck for two weeks now, right?', enIdioms: [SLANG.again, SLANG.stuck] },
  { ts: ts(27, 10, 8), user: 'U01YI', text: '那週四還要出貨嗎？還是先延？', en: 'So are we still shipping on Thursday? Or should we push it?' },
  { ts: ts(27, 10, 9), user: 'U01JIA', text: '我覺得先延比較保險啦', en: 'I think pushing it is the safer call', enIdioms: [SLANG.la], reactions: [r('+1', ['U01YI'])] },
];

const DM_DANA: DemoMsg[] = [
  { ts: ts(27, 8, 20), user: 'U01DANA', text: 'hey <@U01ME> could you look over the color notes before they go to the factory?', zh: '嘿 @mei，送去工廠之前，可以幫忙看一下顏色的備註嗎？' },
];
const DM_OWEN: DemoMsg[] = [{ ts: ts(26, 18, 30), user: 'U01OWEN', text: 'thanks for the photos earlier!', zh: '謝謝你稍早的照片！' }];

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
  C0TAIPEI: TAIPEI.map(toMessage),
  D0DANA: DM_DANA.map(toMessage),
  D0OWEN: DM_OWEN.map(toMessage),
  D0RITA: [],
  D0SAM: [],
};
export const DEMO_THREADS: Record<string, Message[]> = { [THREAD_ROOT]: THREAD.map(toMessage) };

// 譯文表：以「轉成純文字後的原文」為鍵，FakeTranslator 用它回傳設計稿的譯文
const nameOf = (id: string) => DEMO_USERS.find((u) => u.id === id)?.name;
export const DEMO_TRANSLATIONS: Record<string, { zh?: string; idioms?: Idiom[]; en?: string; enIdioms?: Idiom[] }> = Object.fromEntries(
  [...NEWSROOM, ...THREAD, ...GENERAL, ...TAIPEI, ...DM_DANA, ...DM_OWEN].map((m) => [
    mrkdwnToPlain(m.text, { userName: nameOf }).trim(),
    { zh: m.zh, idioms: m.idioms, en: m.en, enIdioms: m.enIdioms },
  ]),
);

// 示範模式稍後送進來的一則私訊，用來看通知與未讀
export const DEMO_INCOMING = {
  channel: 'D0DANA',
  message: toMessage({ ts: '', user: 'U01DANA', text: 'also fwiw the 52cm size is off the spring lineup :sweat_smile:' }),
  zh: '另外順帶一提，52 公分的尺寸不在春季款裡了 😅',
};
DEMO_TRANSLATIONS[mrkdwnToPlain(DEMO_INCOMING.message.text)] = { zh: DEMO_INCOMING.zh, idioms: [IDIOM.fwiw] };

// ---------- 潤色範例 ----------
export const SAMPLE_DRAFT = '我這邊也一樣，樣品的綠色比色卡深。也許是燈光的關係？我明天白天再拍一次';

type Variant = { bubbles: string[]; merged: string | null; back: string; check: [CheckKind, string]; notes: [string, string][] };

export const SAMPLE_VARIANTS: Record<Tone | 'short' | 'warm', Variant> = {
  casual: {
    bubbles: ['yep same, my sample looks darker than the swatch too', 'prob the lighting. will reshoot tomorrow in daylight'],
    merged: 'yep same, my sample looks darker than the swatch too. prob the lighting, will reshoot tomorrow in daylight',
    back: '對啊我也是，我的樣品看起來也比色卡深。<mark>大概</mark>是燈光的關係，我明天白天再重拍。',
    check: ['warn', '「也許」寫成了 prob（大概），語氣比你的原稿篤定一點'],
    notes: [['yep same', '比 same here 更隨意，適合跟熟的同事'], ['prob', 'probably 的縮寫，這個頻道很常見'], ['will reshoot tomorrow', '省略主詞 I，口語訊息很常這樣寫']],
  },
  natural: {
    bubbles: ['same here, the green on my sample looks darker than the swatch too', 'maybe it’s the lighting? will take another photo tomorrow in daylight'],
    merged: 'same here, the green on my sample looks darker than the swatch too. maybe it’s the lighting? will take another photo tomorrow in daylight',
    back: '我這邊也一樣，我的樣品綠色看起來也比色卡深。也許是燈光的關係？我明天白天再拍一張。',
    check: ['ok', '意思一致：沒有新增或漏掉資訊'],
    notes: [
      ['same here', '「我這邊也一樣」。Slack 上最自然的附和，比 I have the same situation 道地得多'],
      ['looks darker than the swatch', '用 look 說「看起來」，也呼應 Owen 剛說的 doesn’t match the swatch'],
      ['小寫開頭、句尾不加句號', '跟這個頻道大多數訊息一致；在這裡正式大寫反而顯得生分'],
      ['in daylight', '「白天」。拍顏色時說 in daylight，大家就知道你要換成自然光'],
    ],
  },
  formal: {
    bubbles: ['Same here. The green on my frame sample also looks darker than the swatch. It may be the lighting, so I’ll take another photo in daylight tomorrow.'],
    merged: null,
    back: '我這邊也一樣，我的<mark>車架</mark>樣品綠色看起來也比色卡深。可能是燈光的關係，所以我明天會在白天再拍一張。',
    check: ['info', '補上了「車架」讓說的是哪個樣品更清楚，其餘意思一致'],
    notes: [['完整句子、正常大小寫', '適合寫給主管，或還不熟的人'], ['It may be the lighting', '用 may 保留你原稿「也許」的不確定'], ['合併成一則', '正式一點的訊息通常不連發']],
  },
  short: {
    bubbles: ['same, mine looks darker than the swatch too', 'prob the lighting. will reshoot tomorrow in daylight'],
    merged: 'same, mine looks darker than the swatch too. prob the lighting, will reshoot tomorrow in daylight',
    back: '一樣，我的也比色卡深。<mark>大概</mark>是燈光，我明天白天重拍。',
    check: ['warn', '「也許」寫成了 prob（大概），語氣比你的原稿篤定一點'],
    notes: [['刪掉可省略的字', 'here、the green 都拿掉了，看上下文就知道說的是顏色'], ['reshoot', '「重拍」，比 take another photo 短']],
  },
  warm: {
    bubbles: ['same here!! the green on my sample looks darker than the swatch too', 'maybe it’s the lighting? will take another photo tomorrow in daylight and report back'],
    merged: 'same here!! the green on my sample looks darker than the swatch too. maybe it’s the lighting? will take another photo tomorrow in daylight and report back',
    back: '我這邊也一樣！！我的樣品綠色看起來也比色卡深。也許是燈光的關係？我明天白天再拍一張，<mark>有結果再回報</mark>。',
    check: ['warn', '多了一句「有結果再回報」（report back），你的原稿沒有這句'],
    notes: [['!!', '兩個驚嘆號讓語氣更熱絡，這個頻道偶爾會這樣用'], ['report back', '「回報結果」。這句是模型加的，不需要就直接刪掉']],
  },
};

// ---------- 英文使用者在中文頻道的潤色範例 ----------
export const SAMPLE_DRAFT_EN = "I'm not totally sure, but I think it only happens on the matte finish? I'll check the glossy frames after lunch";

export const SAMPLE_VARIANTS_EN: Record<Tone, Variant> = {
  casual: {
    bubbles: ['不太確定欸', '好像只有消光的會這樣？我吃完飯看一下亮面的'],
    merged: '不太確定欸，好像只有消光的會這樣？我吃完飯看一下亮面的',
    back: 'Not too sure. It seems only the matte ones do this? I’ll look at the glossy ones after eating',
    check: ['ok', 'Same meaning: nothing added or left out.'],
    notes: [['欸', 'A soft particle that makes the doubt sound casual; people in this channel use it a lot.'], ['吃完飯', '“After eating.” In chat people rarely say 午餐 (lunch).']],
  },
  natural: {
    bubbles: ['我不太確定，但好像只有消光漆會這樣？', '我午餐後看一下亮面的車架'],
    merged: '我不太確定，但好像只有消光漆會這樣？我午餐後看一下亮面的車架',
    back: 'I’m not too sure, but it seems only the matte finish does this?\nI’ll take a look at the glossy frames after lunch',
    check: ['ok', 'Same meaning: nothing added or left out.'],
    notes: [
      ['不太確定', 'Keeps “not totally sure” at the same strength.'],
      ['好像…？', '“I think … ?” becomes 好像 with a question mark, so it still reads as a guess.'],
      ['看一下', '“Take a look.” Softer than 檢查 (inspect), and closer to how this channel talks.'],
      ['No period at the end', 'Most messages here end with no punctuation or with a question mark.'],
    ],
  },
  formal: {
    bubbles: ['我不太確定，不過這個問題似乎只出現在消光漆上。我午餐後會檢查亮面的車架。'],
    merged: null,
    back: 'I’m not quite sure, but <mark>the problem seems to only appear on the matte finish.</mark> I will inspect the glossy frames after lunch.',
    check: ['warn', 'Your question became a statement, so it sounds more certain than your draft.'],
    notes: [['Full sentences', 'Suits a manager or someone you do not know well.'], ['似乎', 'A formal word for “seems”.']],
  },
};

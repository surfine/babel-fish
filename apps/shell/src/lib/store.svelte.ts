import { invoke } from '@tauri-apps/api/core';
import { hasConsent } from './consent';
import { aiErrText } from './translate/errors';
import { GUIDE_PREF_KEY, isCompact, matchesCopied, parseGuidePref, recordDone, type GuidePref } from './guide';
import type { SlackSource } from './slack/source';
import { detectLang, type LangCode } from './lang';
import type { AuthStatus, Conversation, Message, RealtimeEvent, ShellError, Team, User } from './slack/types';
import { GLOSSARY, summarizer, translator, type Translation } from './translate';
import { mentionsUser, mrkdwnToPlain, plainToMrkdwn, type MrkdwnContext } from './mrkdwn';
import { emojiChar } from './emoji';
import { appFocused, notify, setBadge } from './notify';
import { COPY_DRAFT_KEY, lookupCopyDraft, pruneCopyDrafts, recordCopyDraft, type CopyDraftMap } from './copydrafts';

// auto：譯文取代原文（Swiftgram 式）；both：英文下附中文；original：只看原文
export type ReadingMode = 'auto' | 'both' | 'original';
const LEGACY_MODES: Record<string, ReadingMode> = { zh: 'auto', en: 'original' };

export interface PendingSend {
  id: string;
  channel: string;
  threadTs: string | null;
  texts: string[];
  draftZh: string;
  files: File[];
  left: number;
  onUndo: () => void;
}

const UNDO_SECONDS = 5;
const LAST_CHANNEL_KEY = 'rosetta.lastChannel';

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 私密模式等情況寫不進去就算了 */
  }
}

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

class AppStore {
  phase = $state<'boot' | 'login' | 'ready'>('boot');
  source!: SlackSource;
  authNote = $state<string | null>(null);
  loggingIn = $state(false);

  self = $state<User | null>(null);
  team = $state<Team | null>(null);
  conversations = $state<Conversation[]>([]);
  users = $state<Record<string, User>>({});
  customEmoji = $state<Record<string, string>>({});
  activeId = $state<string | null>(null);
  messages = $state<Record<string, Message[]>>({});
  cursors: Record<string, string | null> = {};
  loadingHistory = $state(false);
  connection = $state<'connecting' | 'live' | 'polling' | 'offline'>('connecting');

  thread = $state<{ channel: string; ts: string } | null>(null);
  threadMessages = $state<Message[]>([]);

  translations = $state<Record<string, Translation | null>>({});
  modes = $state<Record<string, ReadingMode>>(load('rosetta.modes', {}));
  // 看得懂、不必翻的語言；預設跳過中文
  skipLangs = $state<LangCode[]>(load('rosetta.skipLangs', ['zh']));
  ownDrafts = $state<Record<string, string>>(load('rosetta.ownDrafts', {}));
  // 唯讀模式（預設開）：Rosetta 不寫入 Slack，英文複製後到官方 Slack 自己送
  readOnly = $state<boolean>(load('rosetta.readOnly', true));
  // 複製時記下的「英文 → 中文原稿」，給官方用戶端送出的訊息對回原稿用
  copyDrafts = $state<CopyDraftMap>(pruneCopyDrafts(load<CopyDraftMap>(COPY_DRAFT_KEY, {}), Date.now()));
  catchup = $state<Record<string, { text: string; count: number } | null>>({});
  pending = $state<PendingSend[]>([]);
  toastMsg = $state<string | null>(null);
  translatedToday = $state(0);
  polishedToday = $state(0);

  private stopRealtime: (() => void) | null = null;
  private queue: { key: string; channel: string; text: string; author?: string }[] = [];
  private queueTimer: ReturnType<typeof setTimeout> | null = null;
  private inflight = 0;
  private lastTranslateError = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private missingUsers = new Set<string>();
  private usersTimer: ReturnType<typeof setTimeout> | null = null;

  // ---------- 啟動與登入 ----------
  async start(source: SlackSource) {
    this.stopRealtime?.();
    this.source = source;
    this.phase = 'boot';
    await source.onAuth((s) => this.onAuth(s));
    // 真 Slack：沒同意風險說明前，不讀鑰匙圈裡的舊登入，停在登入頁
    if (source.kind !== 'demo' && !hasConsent()) {
      this.phase = 'login';
      return;
    }
    try {
      const st = await source.authStatus();
      await this.onAuth(st);
    } catch (e) {
      this.authNote = errText(e);
      this.phase = 'login';
    }
  }

  private async onAuth(s: AuthStatus | { state: 'login_error'; message: string }) {
    if (s.state === 'signed_in') {
      this.loggingIn = false;
      this.authNote = null;
      await this.enter();
    } else if (s.state === 'invalid') {
      this.stopRealtime?.();
      this.loggingIn = false;
      this.authNote = 'Slack 登入失效了，重新登入一次就好。';
      this.phase = 'login';
    } else if (s.state === 'login_error') {
      this.loggingIn = false;
      this.authNote = s.message;
    } else {
      this.phase = 'login';
    }
  }

  async login() {
    if (!hasConsent()) return;
    this.loggingIn = true;
    this.authNote = null;
    try {
      await this.source.beginLogin();
    } catch (e) {
      this.loggingIn = false;
      this.authNote = errText(e);
    }
  }

  async logout() {
    this.stopRealtime?.();
    await this.source.logout().catch(() => {});
    Object.assign(this, { self: null, team: null, conversations: [], messages: {}, activeId: null, thread: null });
    this.phase = 'login';
  }

  private async enter() {
    await this.source.setReadOnly(this.readOnly).catch(() => {});
    const b = await this.source.bootstrap();
    this.self = b.self_user;
    this.team = b.team;
    this.conversations = b.conversations;
    this.users = Object.fromEntries([...b.users, b.self_user].map((u) => [u.id, u]));
    this.phase = 'ready';
    this.source.emojiList().then((e) => (this.customEmoji = e)).catch(() => {});
    this.stopRealtime = await this.source.startRealtime((e) => this.onEvent(e));
    // 打開上次看的頻道；沒有紀錄（或已不在列表）就開第一個
    const lastId = load<string | null>(LAST_CHANNEL_KEY, null);
    const first = this.conversations.find((c) => c.id === lastId) ?? this.conversations[0];
    if (first) await this.open(first.id);
    this.updateBadge();
  }

  // ---------- 頻道 ----------
  get active(): Conversation | undefined {
    return this.conversations.find((c) => c.id === this.activeId);
  }

  async open(id: string) {
    const conv = this.conversations.find((c) => c.id === id);
    if (!conv) return;
    const unreadBefore = conv.unread;
    this.activeId = id;
    save(LAST_CHANNEL_KEY, id);
    this.thread = null;
    this.source.setActive(id).catch(() => {});
    if (!this.messages[id]) {
      this.loadingHistory = true;
      try {
        const page = await this.source.history(id);
        this.messages[id] = page.items;
        this.cursors[id] = page.next_cursor ?? null;
      } catch (e) {
        this.toast('載入訊息失敗：' + errText(e));
        this.messages[id] = [];
      } finally {
        this.loadingHistory = false;
      }
    }
    const list = this.messages[id];
    this.resolveUsers(list);
    this.requestTranslations(id, list);
    if (unreadBefore >= 3) this.makeCatchup(id, list.slice(-unreadBefore));
    this.markRead(id);
  }

  async loadOlder(id: string) {
    const cursor = this.cursors[id];
    if (!cursor || this.loadingHistory) return false;
    this.loadingHistory = true;
    try {
      const page = await this.source.history(id, cursor);
      this.messages[id] = [...page.items, ...(this.messages[id] ?? [])];
      this.cursors[id] = page.next_cursor ?? null;
      this.resolveUsers(page.items);
      this.requestTranslations(id, page.items);
      return true;
    } finally {
      this.loadingHistory = false;
    }
  }

  async setReadOnly(on: boolean) {
    this.readOnly = on;
    save('rosetta.readOnly', on);
    try {
      await this.source.setReadOnly(on);
    } catch (e) {
      this.toast('同步唯讀模式失敗：' + errText(e));
    }
    this.updateBadge();
  }

  // 自己的訊息對應的中文原稿：Rosetta 送出的用 ts；官方用戶端送出的用複製時記下的英文比對
  draftFor(m: Message): string | undefined {
    if (!m.user || m.user !== this.self?.id) return undefined;
    return this.ownDrafts[m.ts] ?? lookupCopyDraft(this.copyDrafts, this.plain(m.text), Date.now());
  }

  // ---------- 貼上引導卡（唯讀模式「複製並打開 Slack」之後） ----------
  guidePref: GuidePref = $state(parseGuidePref(safeGet(GUIDE_PREF_KEY)));
  private pendingGuide: { channel: string; texts: string[] } | null = null;

  setGuideEnabled(enabled: boolean) {
    this.guidePref = { ...this.guidePref, enabled };
    save(GUIDE_PREF_KEY, this.guidePref);
    if (!enabled) invoke('guide_close').catch(() => {});
  }

  async showPasteGuide(o: { channel: string; threadTs: string | null; texts: string[]; slackUrl: string }) {
    if (this.source?.kind !== 'tauri' || !this.guidePref.enabled) return;
    this.pendingGuide = { channel: o.channel, texts: o.texts };
    await invoke('guide_open', {
      data: {
        text: o.texts.join('\n\n'),
        whereLabel: this.convLabel(o.channel),
        whereKind: this.conversations.find((c) => c.id === o.channel)?.kind ?? 'channel',
        isThread: !!o.threadTs,
        compact: isCompact(this.guidePref),
        slackUrl: o.slackUrl,
      },
    }).catch(() => {});
  }

  // 使用者在官方 Slack 送出了剛複製的英文：引導卡顯示完成並收起，計一次
  private checkGuideSent(channel: string, m: Message) {
    const g = this.pendingGuide;
    if (!g || channel !== g.channel || !m.user || m.user !== this.self?.id) return;
    if (!matchesCopied(g.texts, this.plain(m.text))) return;
    this.pendingGuide = null;
    this.guidePref = recordDone(this.guidePref);
    save(GUIDE_PREF_KEY, this.guidePref);
    invoke('guide_sent').catch(() => {});
  }

  // 複製英文時記下原稿；每則泡泡與合併後的全文各記一筆
  rememberCopy(texts: string[], draftZh: string) {
    const now = Date.now();
    let map = this.copyDrafts;
    for (const t of texts) map = recordCopyDraft(map, t, draftZh, now);
    if (texts.length > 1) map = recordCopyDraft(map, texts.join('\n\n'), draftZh, now);
    this.copyDrafts = map;
    save(COPY_DRAFT_KEY, map);
  }

  private markRead(id: string) {
    const conv = this.conversations.find((c) => c.id === id);
    const list = this.messages[id];
    if (!conv || !list?.length) return;
    conv.unread = 0;
    conv.mentions = 0;
    const last = list[list.length - 1].ts;
    if (conv.last_read !== last) {
      conv.last_read = last;
      // 唯讀模式只在記憶體裡清掉未讀，不告訴 Slack
      if (!this.readOnly) this.source.mark(id, last).catch(() => {});
    }
    this.updateBadge();
  }

  private async makeCatchup(id: string, items: Message[]) {
    const plain = items.map((m) => ({ id: m.ts, text: this.plain(m.text), author: this.name(m.user) }));
    const text = await summarizer.summarize(plain, this.convLabel(id));
    this.catchup[id] = { text, count: items.length };
  }

  setMode(id: string, mode: ReadingMode) {
    this.modes[id] = mode;
    save('rosetta.modes', this.modes);
  }
  setSkipLangs(langs: LangCode[]) {
    this.skipLangs = langs;
    save('rosetta.skipLangs', langs);
    // 剛取消跳過的語言要補翻
    for (const [channel, list] of Object.entries(this.messages)) this.requestTranslations(channel, list.slice(-50));
  }
  isSkipped(m: Message): boolean {
    const lang = detectLang(this.plain(m.text));
    return lang !== 'unknown' && this.skipLangs.includes(lang);
  }
  modeOf(id: string | null): ReadingMode {
    const m = id ? this.modes[id] : undefined;
    return (m && (LEGACY_MODES[m] ?? m)) || 'both';
  }

  // ---------- 討論串 ----------
  async openThread(channel: string, ts: string) {
    this.thread = { channel, ts };
    this.threadMessages = [];
    try {
      const list = await this.source.replies(channel, ts);
      if (this.thread?.ts !== ts) return;
      this.threadMessages = list;
      this.resolveUsers(list);
      this.requestTranslations(channel, list);
    } catch (e) {
      this.toast('對話串沒有載入：' + errText(e));
    }
  }
  closeThread() {
    this.thread = null;
  }

  // ---------- 名字與渲染脈絡 ----------
  name(id?: string | null): string {
    if (!id) return '未知';
    const u = this.users[id];
    if (!u) {
      this.missingUsers.add(id);
      this.scheduleUsers();
      return id;
    }
    return u.real_name || u.name;
  }
  convLabel(id: string): string {
    const c = this.conversations.find((x) => x.id === id);
    if (!c) return id;
    if (c.kind === 'im') return this.name(c.user_id);
    if (c.kind === 'mpim') return c.name.replace(/^mpdm-/, '').replace(/-\d+$/, '').split('--').join('、');
    return c.name;
  }
  get mrkdwnCtx(): MrkdwnContext {
    return {
      userName: (id) => this.users[id]?.name,
      channelName: (id) => this.conversations.find((c) => c.id === id)?.name,
      emoji: (name) => {
        const ch = emojiChar(name);
        if (ch) return { char: ch };
        const url = this.customEmoji[name];
        return url ? { url } : undefined;
      },
      selfId: this.self?.id,
    };
  }
  plain(text: string) {
    return mrkdwnToPlain(text, this.mrkdwnCtx).trim();
  }

  private resolveUsers(list: Message[]) {
    for (const m of list) {
      if (m.user && !this.users[m.user]) this.missingUsers.add(m.user);
      for (const r of m.reactions) for (const u of r.users) if (!this.users[u]) this.missingUsers.add(u);
      for (const id of m.text.match(/<@([A-Z0-9]+)/g) ?? []) {
        const uid = id.slice(2);
        if (!this.users[uid]) this.missingUsers.add(uid);
      }
    }
    this.scheduleUsers();
  }
  private scheduleUsers() {
    if (this.usersTimer || !this.missingUsers.size) return;
    this.usersTimer = setTimeout(async () => {
      const ids = [...this.missingUsers].slice(0, 50);
      ids.forEach((i) => this.missingUsers.delete(i));
      this.usersTimer = null;
      try {
        const us = await this.source.usersInfo(ids);
        for (const u of us) this.users[u.id] = u;
      } catch {
        /* 名字拿不到就顯示 id */
      }
      if (this.missingUsers.size) this.scheduleUsers();
    }, 80);
  }

  // ---------- 翻譯 ----------
  tkey(channel: string, m: Message) {
    return `${channel}:${m.ts}:${hash(m.text)}`;
  }
  translationOf(channel: string, m: Message): Translation | null | undefined {
    return this.translations[this.tkey(channel, m)];
  }

  requestTranslations(channel: string, list: Message[], quality: 'fast' | 'strong' = 'fast') {
    for (const m of list) {
      const key = this.tkey(channel, m);
      if (!m.text.trim() || m.subtype === 'channel_join') continue;
      if (this.isSkipped(m)) continue;
      if (quality === 'fast' && key in this.translations) continue;
      if (this.draftFor(m)) continue; // 自己的訊息顯示原稿，不翻
      this.translations[key] = null;
      this.queue.push({ key, channel, text: this.plain(m.text), author: this.name(m.user) });
    }
    if (quality === 'strong') this.flush('strong');
    else if (!this.queueTimer) this.queueTimer = setTimeout(() => this.flush('fast'), 60);
  }

  // 小批次、同時送幾批：翻譯的耗時主要在模型產生文字，一批 5 則、4 批並行比一批 15 則依序快一倍以上
  private flush(quality: 'fast' | 'strong') {
    this.queueTimer = null;
    while (this.queue.length && this.inflight < 4) {
      // 佇列尾端是最新的訊息，先翻畫面最下面看得到的；同一批只放同一個頻道
      const channel = this.queue[this.queue.length - 1].channel;
      const batch: typeof this.queue = [];
      while (batch.length < 5 && this.queue.length && this.queue[this.queue.length - 1].channel === channel) batch.unshift(this.queue.pop()!);
      this.inflight++;
      this.translateBatch(channel, batch, quality).finally(() => {
        this.inflight--;
        this.flush(quality);
      });
    }
  }

  private async translateBatch(channel: string, batch: typeof this.queue, quality: 'fast' | 'strong') {
    const recent = (this.messages[channel] ?? []).slice(-20).map((m) => ({ id: m.ts, text: this.plain(m.text), author: this.name(m.user) }));
    try {
      const out = await translator.translate(
        batch.map((b) => ({ id: b.key, text: b.text, author: b.author })),
        { channel: this.convLabel(channel), recent, glossary: GLOSSARY, quality },
      );
      for (const t of out) this.translations[t.id] = t;
      this.translatedToday += out.length;
      // 模型重送後仍漏掉的：清掉「翻譯中」，之後重新打開頻道會再要一次
      const got = new Set(out.map((t) => t.id));
      for (const b of batch) if (!got.has(b.key)) delete this.translations[b.key];
    } catch (e) {
      for (const b of batch) delete this.translations[b.key];
      // 好幾批同時失敗時只提示一次
      if (Date.now() - this.lastTranslateError > 10_000) {
        this.lastTranslateError = Date.now();
        this.toast('翻譯沒有完成：' + aiErrText(e));
      }
    }
  }

  retranslate(channel: string, m: Message) {
    this.requestTranslations(channel, [m], 'strong');
  }

  // ---------- 送出（5 秒撤回期） ----------
  queueSend(p: Omit<PendingSend, 'id' | 'left'>) {
    const item: PendingSend = { ...p, id: 'p' + Date.now(), left: UNDO_SECONDS };
    this.pending.push(item);
    const tick = setInterval(async () => {
      const cur = this.pending.find((x) => x.id === item.id);
      if (!cur) return clearInterval(tick); // 已撤回
      cur.left -= 1;
      if (cur.left > 0) return;
      clearInterval(tick);
      await this.deliver(cur);
    }, 1000);
    return item.id;
  }

  undo(id: string) {
    const p = this.pending.find((x) => x.id === id);
    if (!p) return;
    this.pending = this.pending.filter((x) => x.id !== id);
    p.onUndo();
    this.toast('已撤回，草稿還在');
  }

  private async deliver(p: PendingSend) {
    const sent: Message[] = [];
    try {
      for (const t of p.texts) sent.push(await this.source.post(p.channel, plainToMrkdwn(t), p.threadTs));
      for (const f of p.files) await this.source.upload(p.channel, p.threadTs, f);
      const last = sent[sent.length - 1];
      if (last) {
        this.ownDrafts[last.ts] = p.draftZh;
        save('rosetta.ownDrafts', this.ownDrafts);
      }
      for (const m of sent) this.insert(p.channel, m);
      this.polishedToday += 1;
      this.toast(`已傳送到 ${this.convLabel(p.channel)}（${sent.length} 則）`);
    } catch (e) {
      // 送到一半失敗：已送出的留著，其餘還原成草稿
      if (sent.length) for (const m of sent) this.insert(p.channel, m);
      this.toast(`沒有傳送成功：${errText(e)}` + (sent.length ? `（已傳送 ${sent.length} 則）` : ''));
      if (!sent.length) p.onUndo();
    } finally {
      this.pending = this.pending.filter((x) => x.id !== p.id);
    }
  }

  private seenReplies = new Set<string>();

  // 放進訊息列表；回傳 false 表示已經有了（例如自己送出後又收到即時事件）
  private insert(channel: string, m: Message): boolean {
    if (m.thread_ts && m.thread_ts !== m.ts) {
      if (this.seenReplies.has(m.ts)) return false;
      this.seenReplies.add(m.ts);
      if (this.thread?.ts === m.thread_ts && !this.threadMessages.some((x) => x.ts === m.ts)) this.threadMessages.push(m);
      const root = this.messages[channel]?.find((x) => x.ts === m.thread_ts);
      if (root) {
        root.thread_ts = root.ts;
        root.reply_count += 1;
        root.latest_reply = m.ts;
        if (m.user && !root.reply_users.includes(m.user)) root.reply_users.push(m.user);
      }
      return true;
    }
    const list = this.messages[channel];
    if (!list) return true; // 還沒打開過的頻道：只算未讀，打開時再載入
    if (list.some((x) => x.ts === m.ts)) return false;
    list.push(m);
    return true;
  }

  // ---------- 修改、刪除、表情回應 ----------
  async edit(channel: string, m: Message, text: string) {
    try {
      await this.source.update(channel, m.ts, plainToMrkdwn(text));
      this.replace(channel, { ...m, text: plainToMrkdwn(text), edited: true });
    } catch (e) {
      this.toast('修改失敗：' + errText(e));
    }
  }
  async remove(channel: string, m: Message) {
    try {
      await this.source.remove(channel, m.ts);
      this.drop(channel, m.ts);
    } catch (e) {
      this.toast('刪除失敗：' + errText(e));
    }
  }
  async toggleReaction(channel: string, m: Message, name: string) {
    const me = this.self?.id ?? '';
    const has = m.reactions.find((r) => r.name === name)?.me ?? false;
    this.applyReaction(channel, m.ts, name, me, !has);
    try {
      await this.source.react(channel, m.ts, name, !has);
    } catch (e) {
      this.applyReaction(channel, m.ts, name, me, has);
      this.toast('表情回應失敗：' + errText(e));
    }
  }

  private eachCopy(channel: string, ts: string, f: (m: Message) => void) {
    for (const m of this.messages[channel] ?? []) if (m.ts === ts) f(m);
    if (this.thread?.channel === channel) for (const m of this.threadMessages) if (m.ts === ts) f(m);
  }
  private applyReaction(channel: string, ts: string, name: string, user: string, added: boolean) {
    this.eachCopy(channel, ts, (m) => {
      const r = m.reactions.find((x) => x.name === name);
      const isMe = user === this.self?.id;
      if (added) {
        if (r?.users.includes(user)) return;
        if (r) Object.assign(r, { count: r.count + 1, users: [...r.users, user], me: r.me || isMe });
        else m.reactions.push({ name, count: 1, users: [user], me: isMe });
      } else if (r && r.users.includes(user)) {
        Object.assign(r, { count: r.count - 1, users: r.users.filter((u) => u !== user), me: isMe ? false : r.me });
        if (r.count <= 0) m.reactions = m.reactions.filter((x) => x !== r);
      }
    });
  }
  private replace(channel: string, m: Message) {
    this.eachCopy(channel, m.ts, (x) => Object.assign(x, m));
    this.requestTranslations(channel, [m]);
  }
  private drop(channel: string, ts: string) {
    if (this.messages[channel]) this.messages[channel] = this.messages[channel].filter((m) => m.ts !== ts);
    if (this.thread?.channel === channel) {
      if (this.thread.ts === ts) this.thread = null;
      else this.threadMessages = this.threadMessages.filter((m) => m.ts !== ts);
    }
  }

  // ---------- 即時事件 ----------
  private onEvent(e: RealtimeEvent) {
    switch (e.type) {
      case 'connection':
        this.connection = e.state;
        return;
      case 'message':
        return this.onMessage(e.channel, e.message);
      case 'message_changed':
        return this.replace(e.channel, e.message);
      case 'message_deleted':
        return this.drop(e.channel, e.ts);
      case 'reaction':
        return this.applyReaction(e.channel, e.ts, e.name, e.user, e.added);
      case 'marked': {
        const c = this.conversations.find((x) => x.id === e.channel);
        if (c) Object.assign(c, { unread: e.unread, mentions: e.mentions, last_read: e.ts });
        this.updateBadge();
        return;
      }
    }
  }

  private onMessage(channel: string, m: Message) {
    const isReply = !!m.thread_ts && m.thread_ts !== m.ts;
    this.checkGuideSent(channel, m);
    if (!this.insert(channel, m)) return;
    this.resolveUsers([m]);
    this.requestTranslations(channel, [m]);
    if (m.user === this.self?.id) return;
    const conv = this.conversations.find((c) => c.id === channel);
    if (!conv) return;
    const watching = channel === this.activeId && appFocused();
    const mentioned = conv.kind === 'im' || conv.kind === 'mpim' || (!!this.self && mentionsUser(m.text, this.self.id));
    if (watching) {
      if (!isReply) this.markRead(channel);
      return;
    }
    if (!isReply) {
      conv.unread += 1;
      if (mentioned) conv.mentions += 1;
    }
    this.updateBadge();
    if (mentioned && !this.readOnly) {
      const where = conv.kind === 'im' ? '私訊' : '#' + conv.name;
      notify(`${this.name(m.user)}（${where}）`, this.plain(m.text) || '傳了一個檔案');
    }
  }

  private updateBadge() {
    setBadge(this.readOnly ? 0 : this.conversations.reduce((n, c) => n + c.mentions, 0));
  }

  toast(msg: string) {
    this.toastMsg = msg;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toastMsg = null), 2600);
  }
}

export function errText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const se = e as ShellError;
    if (se.code === 'rate_limited') return 'Slack 暫時限制了請求次數，等一下再試';
    if (se.code === 'network') return '連不上 Slack，檢查網路後再試';
    return se.message;
  }
  return String(e);
}

export const app = new AppStore();

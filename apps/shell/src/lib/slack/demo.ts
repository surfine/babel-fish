import type { SlackSource } from './source';
import type { AuthStatus, Bootstrap, Message, Page, RealtimeEvent, User } from './types';
import {
  DEMO_CONVERSATIONS,
  DEMO_HISTORY,
  DEMO_INCOMING,
  DEMO_SELF,
  DEMO_TEAM,
  DEMO_THREADS,
  DEMO_USERS,
} from '../demo/data';

const clone = <T>(v: T): T => structuredClone(v);
// Slack 的 ts 在頻道內唯一；示範模式同一毫秒連送兩則時往後推一微秒
let lastTs = 0;
const nowTs = () => {
  lastTs = Math.max(Date.now() * 1000, lastTs + 1);
  return (lastTs / 1e6).toFixed(6);
};

// 示範模式：所有資料在記憶體裡，送出的訊息不會離開這台電腦。
export class DemoSource implements SlackSource {
  readonly kind = 'demo' as const;
  private store = clone(DEMO_HISTORY);
  private threads = clone(DEMO_THREADS);
  private emit: ((e: RealtimeEvent) => void) | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(private incomingAfterMs = 15000) {}

  async authStatus(): Promise<AuthStatus> {
    return { state: 'signed_in', team: DEMO_TEAM, user_id: DEMO_SELF.id };
  }
  async beginLogin() {}
  async logout() {}
  async onAuth() {
    return () => {};
  }

  async bootstrap(): Promise<Bootstrap> {
    return { self_user: DEMO_SELF, team: DEMO_TEAM, conversations: clone(DEMO_CONVERSATIONS), users: clone(DEMO_USERS) };
  }
  async history(channel: string): Promise<Page<Message>> {
    return { items: clone(this.store[channel] ?? []), next_cursor: null };
  }
  async replies(channel: string, ts: string): Promise<Message[]> {
    const root = this.find(channel, ts);
    return clone([...(root ? [root] : []), ...(this.threads[ts] ?? [])]);
  }
  async usersInfo(ids: string[]): Promise<User[]> {
    return DEMO_USERS.filter((u) => ids.includes(u.id));
  }
  async emojiList() {
    return {};
  }

  async post(channel: string, text: string, threadTs?: string | null): Promise<Message> {
    const m: Message = {
      ts: nowTs(), user: DEMO_SELF.id, text, thread_ts: threadTs ?? null, reply_count: 0, reply_users: [],
      edited: false, reactions: [], files: [], subtype: null, bot_name: null, latest_reply: null,
    };
    if (threadTs) {
      (this.threads[threadTs] ??= []).push(m);
      const root = this.find(channel, threadTs);
      if (root) {
        root.reply_count += 1;
        root.thread_ts = threadTs;
        if (!root.reply_users.includes(DEMO_SELF.id)) root.reply_users.push(DEMO_SELF.id);
      }
    } else {
      (this.store[channel] ??= []).push(m);
    }
    return clone(m);
  }
  async update(channel: string, ts: string, text: string) {
    const m = this.find(channel, ts);
    if (m) Object.assign(m, { text, edited: true });
  }
  async remove(channel: string, ts: string) {
    this.store[channel] = (this.store[channel] ?? []).filter((m) => m.ts !== ts);
    for (const k of Object.keys(this.threads)) this.threads[k] = this.threads[k].filter((m) => m.ts !== ts);
  }
  async react(channel: string, ts: string, name: string, add: boolean) {
    const m = this.find(channel, ts);
    if (!m) return;
    const r = m.reactions.find((x) => x.name === name);
    if (add) {
      if (r) {
        if (!r.me) Object.assign(r, { me: true, count: r.count + 1, users: [...r.users, DEMO_SELF.id] });
      } else m.reactions.push({ name, count: 1, users: [DEMO_SELF.id], me: true });
    } else if (r?.me) {
      Object.assign(r, { me: false, count: r.count - 1, users: r.users.filter((u) => u !== DEMO_SELF.id) });
      if (r.count <= 0) m.reactions = m.reactions.filter((x) => x !== r);
    }
  }
  async mark() {}
  async upload(channel: string, threadTs: string | null, file: File) {
    const isImage = file.type.startsWith('image/');
    const url = isImage ? URL.createObjectURL(file) : null;
    const m = await this.post(channel, '', threadTs);
    const stored = this.find(channel, m.ts) ?? this.threads[threadTs ?? '']?.find((x) => x.ts === m.ts);
    const f = { id: 'F' + m.ts, name: file.name, title: file.name, mimetype: file.type, filetype: file.name.split('.').pop() ?? null,
      size: file.size, url_private: url, thumb: url, thumb_w: null, thumb_h: null, permalink: null };
    if (stored) stored.files = [f];
    this.emit?.({ type: 'message', channel, message: clone({ ...m, files: [f] }) });
  }

  async startRealtime(onEvent: (e: RealtimeEvent) => void) {
    this.emit = onEvent;
    onEvent({ type: 'connection', state: 'live' });
    // 過一陣子 Dana 傳來一則私訊，用來看通知、未讀與 dock 徽章
    this.timers.push(
      setTimeout(() => {
        const message = { ...clone(DEMO_INCOMING.message), ts: nowTs() };
        (this.store[DEMO_INCOMING.channel] ??= []).push(message);
        onEvent({ type: 'message', channel: DEMO_INCOMING.channel, message });
      }, this.incomingAfterMs),
    );
    return () => {
      this.emit = null;
      this.timers.forEach(clearTimeout);
    };
  }
  async setReadOnly() {}
  async setActive() {}

  fileUrl(url: string) {
    return url;
  }

  private find(channel: string, ts: string): Message | undefined {
    return (this.store[channel] ?? []).find((m) => m.ts === ts) ?? Object.values(this.threads).flat().find((m) => m.ts === ts);
  }
}

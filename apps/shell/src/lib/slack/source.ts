import type { AuthStatus, Bootstrap, Message, Page, RealtimeEvent, User } from './types';

// 前端看到的 Slack。兩個實作：TauriSource（真 Slack，經 Rust 連線層）與 DemoSource（示範資料）。
export interface SlackSource {
  readonly kind: 'tauri' | 'demo';
  authStatus(): Promise<AuthStatus>;
  beginLogin(): Promise<void>;
  logout(): Promise<void>;
  onAuth(cb: (s: AuthStatus | { state: 'login_error'; message: string }) => void): Promise<() => void>;

  bootstrap(): Promise<Bootstrap>;
  history(channel: string, cursor?: string | null): Promise<Page<Message>>;
  replies(channel: string, ts: string): Promise<Message[]>; // 含根訊息，由舊到新
  usersInfo(ids: string[]): Promise<User[]>;
  emojiList(): Promise<Record<string, string>>;

  post(channel: string, text: string, threadTs?: string | null): Promise<Message>;
  update(channel: string, ts: string, text: string): Promise<void>;
  remove(channel: string, ts: string): Promise<void>;
  react(channel: string, ts: string, name: string, add: boolean): Promise<void>;
  mark(channel: string, ts: string): Promise<void>;
  upload(channel: string, threadTs: string | null, file: File): Promise<void>;

  // 唯讀模式：同步給 Rust，開著時 Rust 端會拒絕所有寫入命令（雙重保險）
  setReadOnly(on: boolean): Promise<void>;

  startRealtime(onEvent: (e: RealtimeEvent) => void): Promise<() => void>;
  setActive(channel: string | null): Promise<void>;

  // 私有檔案網址 → 介面可以直接放進 <img src> 的網址
  fileUrl(url: string): string;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

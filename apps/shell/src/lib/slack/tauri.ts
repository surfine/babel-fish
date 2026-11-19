import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { SlackSource } from './source';
import type { AuthStatus, Bootstrap, Message, Page, RealtimeEvent, ShellError, User } from './types';

// 真 Slack：所有呼叫經 Rust（權杖只在 Rust 與鑰匙圈裡，前端拿不到）。
export class TauriSource implements SlackSource {
  readonly kind = 'tauri' as const;

  authStatus() {
    return call<AuthStatus>('auth_status');
  }
  beginLogin() {
    return call<void>('auth_begin_login');
  }
  logout() {
    return call<void>('auth_logout');
  }
  async onAuth(cb: Parameters<SlackSource['onAuth']>[0]) {
    const offs = await Promise.all([
      listen<AuthStatus>('auth://changed', (e) => cb(e.payload)),
      listen<{ reason: string }>('auth://invalid', (e) => cb({ state: 'invalid', reason: e.payload.reason })),
      listen<{ message: string }>('auth://login_error', (e) => cb({ state: 'login_error', message: e.payload.message })),
    ]);
    return () => offs.forEach((f) => f());
  }

  bootstrap() {
    return call<Bootstrap>('slack_bootstrap');
  }
  history(channel: string, cursor?: string | null) {
    return call<Page<Message>>('slack_history', { channel, cursor: cursor ?? null, limit: 60 });
  }
  replies(channel: string, ts: string) {
    return call<Message[]>('slack_replies', { channel, ts });
  }
  usersInfo(ids: string[]) {
    return call<User[]>('slack_users_info', { ids });
  }
  emojiList() {
    return call<Record<string, string>>('slack_emoji_list');
  }
  post(channel: string, text: string, threadTs?: string | null) {
    return call<Message>('slack_post', { channel, text, threadTs: threadTs ?? null });
  }
  update(channel: string, ts: string, text: string) {
    return call<void>('slack_update', { channel, ts, text });
  }
  remove(channel: string, ts: string) {
    return call<void>('slack_delete', { channel, ts });
  }
  react(channel: string, ts: string, name: string, add: boolean) {
    return call<void>('slack_react', { channel, ts, name, add });
  }
  mark(channel: string, ts: string) {
    return call<void>('slack_mark', { channel, ts });
  }
  async upload(channel: string, threadTs: string | null, file: File) {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    await call<void>('slack_upload', { channel, threadTs, filename: file.name, bytes });
  }
  setReadOnly(on: boolean) {
    return call<void>('set_read_only', { on });
  }
  async startRealtime(onEvent: (e: RealtimeEvent) => void) {
    const off = await listen<RealtimeEvent>('slack://event', (e) => onEvent(e.payload));
    await call<void>('realtime_start');
    return off;
  }
  setActive(channel: string | null) {
    return call<void>('realtime_set_active', { channel });
  }
  fileUrl(url: string) {
    if (url.startsWith('data:')) return url;
    // Rust 端註冊的 slackfile:// 協定代為帶上授權取檔
    return convertFileSrc(url, 'slackfile');
  }
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toShellError(e);
  }
}

export function toShellError(e: unknown): ShellError {
  if (e && typeof e === 'object' && 'code' in e && 'message' in e) return e as ShellError;
  return { code: 'internal', message: String(e) };
}

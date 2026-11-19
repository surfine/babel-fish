// 前端與 Rust 連線層之間的資料形狀。Rust 端（src-tauri/src/slack/model.rs）序列化成同樣的 JSON（snake_case 欄位）。
// 這是 Slack 存取的唯一邊界：換成官方 App 權杖時只換 Rust 端的實作，這裡不動。

export type ConversationKind = 'channel' | 'private' | 'im' | 'mpim';

export interface Conversation {
  id: string;
  name: string; // 頻道名；im 為對方 user id（前端用 users 解析成名字）；mpim 為 Slack 給的 mpdm-… 名稱
  kind: ConversationKind;
  user_id?: string | null; // 只有 im 有：對方是誰
  is_member: boolean;
  unread: number; // 未讀則數（client.counts；拿不到時為 0）
  mentions: number; // 提及你的未讀數
  last_read?: string | null; // ts
  topic?: string | null;
  member_count?: number | null;
}

export interface Reaction {
  name: string; // 不含冒號，例如 "thumbsup" 或 "+1::skin-tone-2"
  count: number;
  users: string[];
  me: boolean; // 自己是否按過
}

export interface SlackFile {
  id: string;
  name: string;
  title?: string | null;
  mimetype?: string | null;
  filetype?: string | null;
  size?: number | null;
  url_private?: string | null; // 需要授權才能取；前端一律透過 slackfile:// 代理
  thumb?: string | null; // 最適合預覽的縮圖網址（約 480px），同樣走代理
  thumb_w?: number | null;
  thumb_h?: number | null;
  permalink?: string | null;
}

export interface Message {
  ts: string;
  user?: string | null;
  bot_name?: string | null; // bot 訊息沒有 user 時的顯示名
  text: string; // Slack mrkdwn 原文
  subtype?: string | null;
  thread_ts?: string | null;
  reply_count: number;
  reply_users: string[];
  latest_reply?: string | null;
  edited: boolean;
  reactions: Reaction[];
  files: SlackFile[];
  previews?: LinkPreview[]; // 連結預覽
}

export interface LinkPreview {
  url: string;
  title?: string | null;
  text?: string | null;
  image?: string | null; // 已走 Slack 圖片代理
  image_w?: number | null;
  image_h?: number | null;
  thumb?: string | null;
  service?: string | null;
  service_icon?: string | null;
}

export interface User {
  id: string;
  name: string; // 顯示名：display_name 優先，其次 real_name，再其次 name
  real_name?: string | null;
  avatar?: string | null; // image_72，公開網址
  color?: string | null; // Slack 給的 hex（不含 #）
  is_bot: boolean;
}

export interface Team {
  id: string;
  name: string;
  url?: string | null;
}

export interface Bootstrap {
  self_user: User;
  team: Team;
  conversations: Conversation[];
  users: User[]; // im 對象與常見成員，先給一批
}

export interface Page<T> {
  items: T[]; // 由舊到新
  next_cursor?: string | null; // 還有更舊的就給
}

// 即時事件：Rust 端從 websocket（或輪詢退路）收到後正規化，emit 到 "slack://event"
export type RealtimeEvent =
  | { type: 'message'; channel: string; message: Message }
  | { type: 'message_changed'; channel: string; message: Message }
  | { type: 'message_deleted'; channel: string; ts: string }
  | { type: 'reaction'; channel: string; ts: string; name: string; user: string; added: boolean }
  | { type: 'marked'; channel: string; ts: string; unread: number; mentions: number }
  | { type: 'connection'; state: 'connecting' | 'live' | 'polling' | 'offline' };

export type AuthStatus =
  | { state: 'signed_out' }
  | { state: 'signed_in'; team: Team; user_id: string }
  | { state: 'invalid'; reason: string }; // 權杖被作廢或過期，要重新登入

// Rust 命令的錯誤一律序列化成這個形狀
export interface ShellError {
  code: 'auth_invalid' | 'not_signed_in' | 'rate_limited' | 'api' | 'network' | 'internal';
  message: string;
}

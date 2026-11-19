//! 與前端 `types.ts` 一致的資料型別，以及從 Slack 原始 JSON 正規化的函式。
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConversationKind {
    Channel,
    Private,
    Im,
    Mpim,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Conversation {
    pub id: String,
    pub name: String,
    pub kind: ConversationKind,
    pub user_id: Option<String>,
    pub is_member: bool,
    pub unread: u32,
    pub mentions: u32,
    pub last_read: Option<String>,
    pub topic: Option<String>,
    pub member_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Reaction {
    pub name: String,
    pub count: u32,
    pub users: Vec<String>,
    pub me: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SlackFile {
    pub id: String,
    pub name: String,
    pub title: Option<String>,
    pub mimetype: Option<String>,
    pub filetype: Option<String>,
    pub size: Option<u64>,
    pub url_private: Option<String>,
    pub thumb: Option<String>,
    pub thumb_w: Option<u32>,
    pub thumb_h: Option<u32>,
    pub permalink: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Message {
    pub ts: String,
    pub user: Option<String>,
    pub bot_name: Option<String>,
    pub text: String,
    pub subtype: Option<String>,
    pub thread_ts: Option<String>,
    pub reply_count: u32,
    pub reply_users: Vec<String>,
    pub latest_reply: Option<String>,
    pub edited: bool,
    pub reactions: Vec<Reaction>,
    pub files: Vec<SlackFile>,
    /// 連結預覽（Slack 的 unfurl，放在 attachments 裡）
    #[serde(default)]
    pub previews: Vec<LinkPreview>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LinkPreview {
    pub url: String,
    pub title: Option<String>,
    pub text: Option<String>,
    /// 預覽圖，已換成 Slack 的圖片代理網址（和官方用戶端一樣，不直接連到對方網站）
    pub image: Option<String>,
    pub image_w: Option<u32>,
    pub image_h: Option<u32>,
    /// 小圖（縮圖），排在右側
    pub thumb: Option<String>,
    pub service: Option<String>,
    pub service_icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct User {
    pub id: String,
    pub name: String,
    pub real_name: Option<String>,
    pub avatar: Option<String>,
    pub color: Option<String>,
    pub is_bot: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Team {
    pub id: String,
    pub name: String,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Bootstrap {
    pub self_user: User,
    pub team: Team,
    pub conversations: Vec<Conversation>,
    pub users: Vec<User>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RealtimeEvent {
    Message { channel: String, message: Message },
    MessageChanged { channel: String, message: Message },
    MessageDeleted { channel: String, ts: String },
    Reaction { channel: String, ts: String, name: String, user: String, added: bool },
    Marked { channel: String, ts: String, unread: u32, mentions: u32 },
    Connection { state: ConnectionState },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    Connecting,
    Live,
    Polling,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum AuthStatus {
    SignedOut,
    SignedIn { team: Team, user_id: String },
    Invalid { reason: String },
}

// ---------- 正規化 ----------

fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).filter(|x| !x.is_empty()).map(str::to_string)
}

fn u(v: &Value, key: &str) -> u32 {
    v.get(key)
        .and_then(|x| x.as_u64().or_else(|| x.as_str().and_then(|t| t.parse().ok())))
        .unwrap_or(0) as u32
}

pub fn normalize_user(v: &Value) -> Option<User> {
    let id = s(v, "id")?;
    let profile = v.get("profile").cloned().unwrap_or(Value::Null);
    let name = s(&profile, "display_name")
        .or_else(|| s(&profile, "real_name"))
        .or_else(|| s(v, "real_name"))
        .or_else(|| s(v, "name"))
        .unwrap_or_else(|| id.clone());
    Some(User {
        id,
        name,
        real_name: s(&profile, "real_name").or_else(|| s(v, "real_name")),
        avatar: s(&profile, "image_72"),
        color: s(v, "color"),
        is_bot: v.get("is_bot").and_then(Value::as_bool).unwrap_or(false),
    })
}

pub fn normalize_file(v: &Value) -> Option<SlackFile> {
    let id = s(v, "id")?;
    let (thumb, w, h) = ["thumb_480", "thumb_360", "thumb_160"]
        .iter()
        .find_map(|k| {
            s(v, k).map(|url| {
                let w = u(v, &format!("{k}_w"));
                let h = u(v, &format!("{k}_h"));
                (Some(url), (w > 0).then_some(w), (h > 0).then_some(h))
            })
        })
        .unwrap_or((None, None, None));
    Some(SlackFile {
        name: s(v, "name").or_else(|| s(v, "title")).unwrap_or_else(|| id.clone()),
        id,
        title: s(v, "title"),
        mimetype: s(v, "mimetype"),
        filetype: s(v, "filetype"),
        size: v.get("size").and_then(Value::as_u64),
        url_private: s(v, "url_private"),
        thumb,
        thumb_w: w,
        thumb_h: h,
        permalink: s(v, "permalink"),
    })
}

pub fn normalize_message(v: &Value, self_id: &str) -> Option<Message> {
    let ts = s(v, "ts")?;
    let reactions = v
        .get("reactions")
        .and_then(Value::as_array)
        .map(|rs| {
            rs.iter()
                .filter_map(|r| {
                    let name = s(r, "name")?;
                    let users: Vec<String> = r
                        .get("users")
                        .and_then(Value::as_array)
                        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
                        .unwrap_or_default();
                    let me = users.iter().any(|x| x == self_id);
                    Some(Reaction { name, count: u(r, "count"), users, me })
                })
                .collect()
        })
        .unwrap_or_default();
    let files = v
        .get("files")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(normalize_file).collect())
        .unwrap_or_default();
    let reply_users = v
        .get("reply_users")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    Some(Message {
        ts,
        user: s(v, "user"),
        bot_name: s(v, "username")
            .or_else(|| v.get("bot_profile").and_then(|b| s(b, "name"))),
        text: v.get("text").and_then(Value::as_str).unwrap_or("").to_string(),
        subtype: s(v, "subtype"),
        thread_ts: s(v, "thread_ts"),
        reply_count: u(v, "reply_count"),
        reply_users,
        latest_reply: s(v, "latest_reply"),
        edited: v.get("edited").is_some_and(|e| !e.is_null()),
        reactions,
        files,
        previews: v
            .get("attachments")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(normalize_preview).collect())
            .unwrap_or_default(),
    })
}

/// 外部圖片改走 Slack 的圖片代理（slack-imgs.com），對方網站看不到使用者的位址
pub fn proxy_image(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    match u.scheme() {
        "https" | "http" => {}
        _ => return None,
    }
    if u.host_str().is_some_and(|h| h == "slack-imgs.com" || h.ends_with(".slack-edge.com")) {
        return Some(url.to_string());
    }
    let enc: String = url::form_urlencoded::byte_serialize(url.as_bytes()).collect();
    Some(format!("https://slack-imgs.com/?c=1&o1=ro&url={enc}"))
}

/// 只收連結預覽（有 from_url 或 original_url 的 attachment），一般 bot 附件不畫
pub fn normalize_preview(a: &Value) -> Option<LinkPreview> {
    let url = s(a, "from_url").or_else(|| s(a, "original_url"))?;
    let title = s(a, "title").or_else(|| s(a, "fallback")).filter(|t| !t.trim().is_empty());
    let text = s(a, "text").filter(|t| !t.trim().is_empty());
    let image = s(a, "image_url").and_then(|u| proxy_image(&u));
    let thumb = if image.is_none() { s(a, "thumb_url").and_then(|u| proxy_image(&u)) } else { None };
    if title.is_none() && text.is_none() && image.is_none() && thumb.is_none() {
        return None;
    }
    let n = |k: &str| a.get(k).and_then(Value::as_u64).map(|x| x as u32);
    Some(LinkPreview {
        url,
        title,
        text,
        image,
        image_w: n("image_width"),
        image_h: n("image_height"),
        thumb,
        service: s(a, "service_name").or_else(|| s(a, "author_name")),
        service_icon: s(a, "service_icon").and_then(|u| proxy_image(&u)),
    })
}

pub fn conversation_kind(v: &Value) -> ConversationKind {
    let flag = |k: &str| v.get(k).and_then(Value::as_bool).unwrap_or(false);
    if flag("is_im") {
        ConversationKind::Im
    } else if flag("is_mpim") {
        ConversationKind::Mpim
    } else if flag("is_private") {
        ConversationKind::Private
    } else {
        ConversationKind::Channel
    }
}

pub fn normalize_conversation(v: &Value) -> Option<Conversation> {
    let id = s(v, "id")?;
    let kind = conversation_kind(v);
    let user_id = if kind == ConversationKind::Im { s(v, "user") } else { None };
    let name = match kind {
        ConversationKind::Im => user_id.clone().unwrap_or_else(|| id.clone()),
        _ => s(v, "name").unwrap_or_else(|| id.clone()),
    };
    Some(Conversation {
        id,
        name,
        kind,
        user_id,
        is_member: v.get("is_member").and_then(Value::as_bool).unwrap_or(true),
        unread: 0,
        mentions: 0,
        last_read: s(v, "last_read"),
        topic: v.get("topic").and_then(|t| s(t, "value")),
        member_count: v.get("num_members").and_then(Value::as_u64).map(|n| n as u32),
    })
}

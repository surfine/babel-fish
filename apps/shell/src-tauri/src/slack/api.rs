//! `SlackApi` 是換權杖種類的邊界：前端命令只依賴這個 trait。
//!
//! 目前唯一的實作 `WebSessionSlack` 使用網頁版登入權杖（xoxc + `d` cookie）。
//! 之後若改用官方 App 權杖（xoxp / xoxb），建立 `Credentials { cookie: None, .. }`
//! 並沿用同一個 `WebSessionSlack` 即可（transport 在 cookie 為 None 時不送 Cookie header），
//! 或另外實作 `SlackApi`，前端與命令層都不必改。
use super::client::{params, SlackClient};
use super::model::*;
use super::transport::BytesResponse;
pub use super::transport::Credentials;
use crate::error::SlackError;
use async_trait::async_trait;
use futures_util::{stream, StreamExt};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub struct AuthInfo {
    pub team_id: String,
    pub team: String,
    pub url: Option<String>,
    pub user_id: String,
}

#[async_trait]
pub trait SlackApi: Send + Sync {
    async fn auth_test(&self) -> Result<AuthInfo, SlackError>;
    async fn bootstrap(&self) -> Result<Bootstrap, SlackError>;
    /// 回傳由舊到新。`oldest` 只給輪詢退路用。
    async fn history(&self, channel: &str, cursor: Option<&str>, limit: u32, oldest: Option<&str>) -> Result<Page<Message>, SlackError>;
    async fn replies(&self, channel: &str, ts: &str) -> Result<Vec<Message>, SlackError>;
    async fn users_info(&self, ids: &[String]) -> Result<Vec<User>, SlackError>;
    async fn post_message(&self, channel: &str, text: &str, thread_ts: Option<&str>) -> Result<Message, SlackError>;
    async fn update_message(&self, channel: &str, ts: &str, text: &str) -> Result<(), SlackError>;
    async fn delete_message(&self, channel: &str, ts: &str) -> Result<(), SlackError>;
    async fn react(&self, channel: &str, ts: &str, name: &str, add: bool) -> Result<(), SlackError>;
    async fn mark(&self, channel: &str, ts: &str) -> Result<(), SlackError>;
    async fn upload_file(&self, channel: &str, thread_ts: Option<&str>, filename: &str, bytes: Vec<u8>) -> Result<(), SlackError>;
    async fn emoji_list(&self) -> Result<HashMap<String, String>, SlackError>;
    async fn fetch_file(&self, url: &str) -> Result<BytesResponse, SlackError>;
    /// 即時連線用：回傳 rtm.connect 的 websocket 網址。
    async fn rtm_connect(&self) -> Result<String, SlackError>;
    /// 即時連線帶 Cookie header 用；官方權杖為 None。
    fn cookie_header(&self) -> Option<String>;
    fn self_id(&self) -> String;
}

pub struct WebSessionSlack {
    client: SlackClient,
    self_id: String,
    cookie: Option<String>,
}

impl WebSessionSlack {
    pub fn new(client: SlackClient, self_id: String, cookie: Option<String>) -> Self {
        WebSessionSlack { client, self_id, cookie }
    }
}

fn next_cursor(v: &Value) -> Option<String> {
    v.pointer("/response_metadata/next_cursor")
        .and_then(Value::as_str)
        .filter(|c| !c.is_empty())
        .map(str::to_string)
}

fn messages_of(v: &Value, key: &str, self_id: &str) -> Vec<Message> {
    v.get(key)
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|m| normalize_message(m, self_id)).collect())
        .unwrap_or_default()
}

/// client.counts 是網頁版內部 API，格式沒有公開文件。這裡寬鬆解析：
/// 在 channels / groups / mpims / ims 陣列中依 `id` 對應，讀 `mention_count[_display]`、
/// `unread_count[_display]`；只有 `has_unreads: true` 而沒有數字時視為 1 則未讀。
pub fn apply_counts(convs: &mut [Conversation], counts: &Value) {
    let mut by_id: HashMap<&str, &Value> = HashMap::new();
    for key in ["channels", "groups", "mpims", "ims"] {
        if let Some(a) = counts.get(key).and_then(Value::as_array) {
            for c in a {
                if let Some(id) = c.get("id").and_then(Value::as_str) {
                    by_id.insert(id, c);
                }
            }
        }
    }
    let num = |c: &Value, keys: &[&str]| -> Option<u32> {
        keys.iter()
            .find_map(|k| c.get(*k).and_then(|x| x.as_u64().or_else(|| x.as_str().and_then(|t| t.parse().ok()))))
            .map(|n| n as u32)
    };
    for conv in convs.iter_mut() {
        if let Some(c) = by_id.get(conv.id.as_str()) {
            conv.mentions = num(c, &["mention_count_display", "mention_count"]).unwrap_or(0);
            let unread = num(c, &["unread_count_display", "unread_count"]);
            let has = c.get("has_unreads").and_then(Value::as_bool).unwrap_or(false);
            conv.unread = unread.unwrap_or(u32::from(has));
            if conv.last_read.is_none() {
                conv.last_read = c.get("last_read").and_then(Value::as_str).map(str::to_string);
            }
        }
    }
}

pub fn resolve_emoji(raw: &HashMap<String, String>) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for (name, val) in raw {
        let mut cur = val.as_str();
        let mut hops = 0;
        while let Some(target) = cur.strip_prefix("alias:") {
            match raw.get(target) {
                Some(next) if hops < 5 => {
                    cur = next.as_str();
                    hops += 1;
                }
                // 指向內建 emoji（不在自訂表中）：保留 alias:xxx 讓前端自己解
                _ => break,
            }
        }
        out.insert(name.clone(), cur.to_string());
    }
    out
}

#[async_trait]
impl SlackApi for WebSessionSlack {
    async fn auth_test(&self) -> Result<AuthInfo, SlackError> {
        let v = self.client.call("auth.test", vec![]).await?;
        let g = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
        Ok(AuthInfo {
            team_id: g("team_id").unwrap_or_default(),
            team: g("team").unwrap_or_default(),
            url: g("url"),
            user_id: g("user_id").ok_or_else(|| SlackError::Api("auth_test_no_user".into()))?,
        })
    }

    async fn bootstrap(&self) -> Result<Bootstrap, SlackError> {
        let info = self.auth_test().await?;
        let mut convs: Vec<Conversation> = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let mut p = params(&[
                ("types", "public_channel,private_channel,mpim,im"),
                ("exclude_archived", "true"),
                ("limit", "200"),
            ]);
            if let Some(c) = &cursor {
                p.push(("cursor".into(), c.clone()));
            }
            let v = self.client.call("users.conversations", p).await?;
            if let Some(a) = v.get("channels").and_then(Value::as_array) {
                convs.extend(a.iter().filter_map(normalize_conversation));
            }
            cursor = next_cursor(&v);
            if cursor.is_none() {
                break;
            }
        }
        // client.counts：拿不到（AuthInvalid 以外的任何失敗）就維持 0
        match self
            .client
            .call(
                "client.counts",
                params(&[("thread_counts_by_channel", "true"), ("org_wide_aware", "true"), ("include_file_channels", "true")]),
            )
            .await
        {
            Ok(counts) => apply_counts(&mut convs, &counts),
            Err(SlackError::AuthInvalid) => return Err(SlackError::AuthInvalid),
            Err(_) => {}
        }
        let mut ids: Vec<String> = vec![self.self_id.clone()];
        for c in &convs {
            if let Some(u) = &c.user_id {
                if !ids.contains(u) {
                    ids.push(u.clone());
                }
            }
        }
        let users = self.users_info(&ids).await?;
        let self_user = users.iter().find(|u| u.id == self.self_id).cloned().unwrap_or(User {
            id: self.self_id.clone(),
            name: self.self_id.clone(),
            real_name: None,
            avatar: None,
            color: None,
            is_bot: false,
        });
        Ok(Bootstrap { self_user, team: Team { id: info.team_id, name: info.team, url: info.url }, conversations: convs, users })
    }

    async fn history(&self, channel: &str, cursor: Option<&str>, limit: u32, oldest: Option<&str>) -> Result<Page<Message>, SlackError> {
        let mut p = params(&[("channel", channel), ("limit", &limit.to_string())]);
        if let Some(c) = cursor {
            p.push(("cursor".into(), c.into()));
        }
        if let Some(o) = oldest {
            p.push(("oldest".into(), o.into()));
        }
        let v = self.client.call("conversations.history", p).await?;
        let mut items = messages_of(&v, "messages", &self.self_id);
        items.reverse();
        Ok(Page { items, next_cursor: next_cursor(&v) })
    }

    async fn replies(&self, channel: &str, ts: &str) -> Result<Vec<Message>, SlackError> {
        let mut out = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let mut p = params(&[("channel", channel), ("ts", ts), ("limit", "200")]);
            if let Some(c) = &cursor {
                p.push(("cursor".into(), c.clone()));
            }
            let v = self.client.call("conversations.replies", p).await?;
            out.extend(messages_of(&v, "messages", &self.self_id));
            cursor = next_cursor(&v);
            if cursor.is_none() {
                break;
            }
        }
        Ok(out)
    }

    async fn users_info(&self, ids: &[String]) -> Result<Vec<User>, SlackError> {
        let results: Vec<Result<Value, SlackError>> = stream::iter(ids.iter().cloned())
            .map(|id| {
                let client = self.client.clone();
                async move { client.call("users.info", params(&[("user", &id)])).await }
            })
            .buffered(6)
            .collect()
            .await;
        let mut out = Vec::new();
        for r in results {
            match r {
                Ok(v) => out.extend(v.get("user").and_then(normalize_user)),
                Err(SlackError::AuthInvalid) => return Err(SlackError::AuthInvalid),
                // 單一使用者查不到（user_not_found 等）不影響其他人
                Err(_) => {}
            }
        }
        Ok(out)
    }

    async fn post_message(&self, channel: &str, text: &str, thread_ts: Option<&str>) -> Result<Message, SlackError> {
        let mut p = params(&[("channel", channel), ("text", text), ("as_user", "true")]);
        if let Some(t) = thread_ts {
            p.push(("thread_ts".into(), t.into()));
        }
        let v = self.client.call("chat.postMessage", p).await?;
        let mut m = v
            .get("message")
            .and_then(|m| normalize_message(m, &self.self_id))
            .or_else(|| {
                let ts = v.get("ts").and_then(Value::as_str)?;
                normalize_message(&serde_json::json!({"ts": ts, "text": text}), &self.self_id)
            })
            .ok_or_else(|| SlackError::Api("post_no_message".into()))?;
        if m.user.is_none() && m.bot_name.is_none() {
            m.user = Some(self.self_id.clone());
        }
        if m.thread_ts.is_none() {
            m.thread_ts = thread_ts.map(str::to_string);
        }
        Ok(m)
    }

    async fn update_message(&self, channel: &str, ts: &str, text: &str) -> Result<(), SlackError> {
        self.client.call("chat.update", params(&[("channel", channel), ("ts", ts), ("text", text)])).await.map(|_| ())
    }

    async fn delete_message(&self, channel: &str, ts: &str) -> Result<(), SlackError> {
        self.client.call("chat.delete", params(&[("channel", channel), ("ts", ts)])).await.map(|_| ())
    }

    async fn react(&self, channel: &str, ts: &str, name: &str, add: bool) -> Result<(), SlackError> {
        let method = if add { "reactions.add" } else { "reactions.remove" };
        match self.client.call(method, params(&[("channel", channel), ("timestamp", ts), ("name", name)])).await {
            // 已按過／已移除：視為成功（冪等）
            Err(SlackError::Api(c)) if c == "already_reacted" || c == "no_reaction" => Ok(()),
            other => other.map(|_| ()),
        }
    }

    async fn mark(&self, channel: &str, ts: &str) -> Result<(), SlackError> {
        self.client.call("conversations.mark", params(&[("channel", channel), ("ts", ts)])).await.map(|_| ())
    }

    async fn upload_file(&self, channel: &str, thread_ts: Option<&str>, filename: &str, bytes: Vec<u8>) -> Result<(), SlackError> {
        let len = bytes.len().to_string();
        let v = self.client.call("files.getUploadURLExternal", params(&[("filename", filename), ("length", &len)])).await?;
        let upload_url = v.get("upload_url").and_then(Value::as_str).ok_or_else(|| SlackError::Api("no_upload_url".into()))?.to_string();
        let file_id = v.get("file_id").and_then(Value::as_str).ok_or_else(|| SlackError::Api("no_file_id".into()))?.to_string();
        let status = self.client.post_bytes(&upload_url, bytes).await?;
        if !(200..300).contains(&status) {
            return Err(SlackError::Api(format!("upload_http_{status}")));
        }
        let files = serde_json::json!([{ "id": file_id, "title": filename }]).to_string();
        let mut p = params(&[("files", &files), ("channel_id", channel)]);
        if let Some(t) = thread_ts {
            p.push(("thread_ts".into(), t.into()));
        }
        self.client.call("files.completeUploadExternal", p).await.map(|_| ())
    }

    async fn emoji_list(&self) -> Result<HashMap<String, String>, SlackError> {
        let v = self.client.call("emoji.list", vec![]).await?;
        let raw: HashMap<String, String> = v
            .get("emoji")
            .and_then(Value::as_object)
            .map(|o| o.iter().filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string()))).collect())
            .unwrap_or_default();
        Ok(resolve_emoji(&raw))
    }

    async fn fetch_file(&self, url: &str) -> Result<BytesResponse, SlackError> {
        self.client.get_bytes(url).await
    }

    async fn rtm_connect(&self) -> Result<String, SlackError> {
        let v = self.client.call("rtm.connect", vec![]).await?;
        v.get("url").and_then(Value::as_str).map(str::to_string).ok_or_else(|| SlackError::Api("rtm_no_url".into()))
    }

    fn cookie_header(&self) -> Option<String> {
        self.cookie.as_ref().map(|c| format!("d={}", super::transport::urlencoding_encode(c)))
    }

    fn self_id(&self) -> String {
        self.self_id.clone()
    }
}

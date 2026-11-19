//! 即時連線：rtm.connect + websocket，失敗時退到輪詢。
//!
//! 假設（無法在沒有真 Slack 的環境驗證）：xoxc 權杖搭配 `d` cookie 可以呼叫 rtm.connect，
//! 且 websocket 握手需要同一個 Cookie header。若 rtm.connect 對 xoxc 不可用，
//! 三次失敗後會自動退到輪詢，前端只會看到 connection 狀態變成 `polling`。
use super::api::SlackApi;
use super::model::*;
use crate::error::SlackError;
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message as WsMessage;

pub type Emit = Arc<dyn Fn(RealtimeEvent) + Send + Sync>;

/// 把 RTM frame 正規化成前端事件；不認得或不需要的 frame 回傳 None。
pub fn parse_rtm_event(v: &Value, self_id: &str) -> Option<RealtimeEvent> {
    let ty = v.get("type")?.as_str()?;
    let s = |x: &Value, k: &str| x.get(k).and_then(Value::as_str).map(str::to_string);
    let n = |k: &str| v.get(k).and_then(|x| x.as_u64().or_else(|| x.as_str().and_then(|t| t.parse().ok()))).unwrap_or(0) as u32;
    match ty {
        "message" => {
            let channel = s(v, "channel")?;
            match v.get("subtype").and_then(Value::as_str) {
                Some("message_changed") | Some("message_replied") => {
                    let message = normalize_message(v.get("message")?, self_id)?;
                    Some(RealtimeEvent::MessageChanged { channel, message })
                }
                Some("message_deleted") => {
                    let ts = s(v, "deleted_ts").or_else(|| v.get("previous_message").and_then(|m| s(m, "ts")))?;
                    Some(RealtimeEvent::MessageDeleted { channel, ts })
                }
                _ => {
                    if v.get("hidden").and_then(Value::as_bool) == Some(true) {
                        return None;
                    }
                    Some(RealtimeEvent::Message { channel, message: normalize_message(v, self_id)? })
                }
            }
        }
        "reaction_added" | "reaction_removed" => {
            let item = v.get("item")?;
            if item.get("type").and_then(Value::as_str) != Some("message") {
                return None;
            }
            Some(RealtimeEvent::Reaction {
                channel: s(item, "channel")?,
                ts: s(item, "ts")?,
                name: s(v, "reaction")?,
                user: s(v, "user")?,
                added: ty == "reaction_added",
            })
        }
        "channel_marked" | "group_marked" | "im_marked" | "mpim_marked" => Some(RealtimeEvent::Marked {
            channel: s(v, "channel")?,
            ts: s(v, "ts")?,
            unread: n("unread_count_display"),
            mentions: n("mention_count_display"),
        }),
        _ => None,
    }
}

pub fn ts_gt(a: &str, b: &str) -> bool {
    let p = |x: &str| x.parse::<f64>().unwrap_or(0.0);
    p(a) > p(b)
}

/// 記錄每個頻道最後看到的 ts，輪詢時當作 `oldest`。
#[derive(Clone, Default)]
pub struct Tracker(Arc<Mutex<HashMap<String, String>>>);

impl Tracker {
    pub fn note(&self, ev: &RealtimeEvent) {
        if let RealtimeEvent::Message { channel, message } = ev {
            let mut m = self.0.lock().unwrap();
            if m.get(channel).is_none_or(|old| ts_gt(&message.ts, old)) {
                m.insert(channel.clone(), message.ts.clone());
            }
        }
    }
    pub fn get(&self, channel: &str) -> Option<String> {
        self.0.lock().unwrap().get(channel).cloned()
    }
    pub fn set(&self, channel: &str, ts: &str) {
        self.0.lock().unwrap().insert(channel.to_string(), ts.to_string());
    }
}

fn connection(emit: &Emit, state: ConnectionState) {
    emit(RealtimeEvent::Connection { state });
}

fn backoff_secs(failures: u32) -> u64 {
    (1u64 << failures.min(5)).min(30)
}

/// 一次 websocket 連線；正常斷線回 Ok，連不上回 Err。
async fn session(api: &Arc<dyn SlackApi>, emit: &Emit, tracker: &Tracker, self_id: &str) -> Result<(), SlackError> {
    let url = api.rtm_connect().await?;
    let mut req = url.as_str().into_client_request().map_err(|_| SlackError::Network("rtm: 網址無效".into()))?;
    if let Some(c) = api.cookie_header() {
        if let Ok(h) = c.parse() {
            req.headers_mut().insert("Cookie", h);
        }
    }
    let (ws, _) = tokio::time::timeout(Duration::from_secs(20), tokio_tungstenite::connect_async(req))
        .await
        .map_err(|_| SlackError::Network("rtm: 連線逾時".into()))?
        .map_err(|e| SlackError::Network(format!("rtm: {e}")))?;
    connection(emit, ConnectionState::Live);
    let (mut tx, mut rx) = ws.split();
    let mut ping = tokio::time::interval(Duration::from_secs(25));
    let mut ping_id = 0u64;
    loop {
        tokio::select! {
            _ = ping.tick() => {
                ping_id += 1;
                let frame = serde_json::json!({"type": "ping", "id": ping_id}).to_string();
                tx.send(WsMessage::text(frame)).await.map_err(|e| SlackError::Network(format!("rtm: {e}")))?;
            }
            frame = tokio::time::timeout(Duration::from_secs(90), rx.next()) => {
                match frame {
                    Err(_) => return Err(SlackError::Network("rtm: 太久沒有資料".into())),
                    Ok(None) => return Ok(()),
                    Ok(Some(Err(e))) => return Err(SlackError::Network(format!("rtm: {e}"))),
                    Ok(Some(Ok(WsMessage::Text(t)))) => {
                        if let Ok(v) = serde_json::from_str::<Value>(t.as_str()) {
                            if v.get("type").and_then(Value::as_str) == Some("goodbye") {
                                return Ok(());
                            }
                            if let Some(ev) = parse_rtm_event(&v, self_id) {
                                tracker.note(&ev);
                                emit(ev);
                            }
                        }
                    }
                    Ok(Some(Ok(WsMessage::Close(_)))) => return Ok(()),
                    Ok(Some(Ok(_))) => {}
                }
            }
        }
    }
}

/// 輪詢一次目前頻道。第一次看到頻道時只記錄最新 ts，不補發舊訊息。
pub async fn poll_once(api: &Arc<dyn SlackApi>, emit: &Emit, tracker: &Tracker, channel: &str) -> Result<(), SlackError> {
    match tracker.get(channel) {
        None => {
            let page = api.history(channel, None, 1, None).await?;
            if let Some(m) = page.items.last() {
                tracker.set(channel, &m.ts);
            }
        }
        Some(last) => {
            let page = api.history(channel, None, 100, Some(&last)).await?;
            for message in page.items.into_iter().filter(|m| ts_gt(&m.ts, &last)) {
                let ev = RealtimeEvent::Message { channel: channel.to_string(), message };
                tracker.note(&ev);
                emit(ev);
            }
        }
    }
    Ok(())
}

/// 主迴圈。只有 AuthInvalid 會讓它結束（回 Err）；其餘一律重連或退到輪詢。
pub async fn run(api: Arc<dyn SlackApi>, emit: Emit, active: watch::Receiver<Option<String>>) -> Result<(), SlackError> {
    let self_id = api.self_id();
    let tracker = Tracker::default();
    let mut failures = 0u32;
    loop {
        connection(&emit, ConnectionState::Connecting);
        match session(&api, &emit, &tracker, &self_id).await {
            Ok(()) => {
                failures = 0;
                connection(&emit, ConnectionState::Offline);
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            Err(SlackError::AuthInvalid) => return Err(SlackError::AuthInvalid),
            Err(_) => failures += 1,
        }
        if failures >= 3 {
            connection(&emit, ConnectionState::Polling);
            // 每 15 秒輪詢，滿 60 秒再試一次 websocket
            for _ in 0..4 {
                tokio::time::sleep(Duration::from_secs(15)).await;
                let channel = active.borrow().clone();
                if let Some(ch) = channel {
                    if let Err(SlackError::AuthInvalid) = poll_once(&api, &emit, &tracker, &ch).await {
                        return Err(SlackError::AuthInvalid);
                    }
                }
            }
            failures = 2; // 再失敗一次就回到輪詢
        } else if failures > 0 {
            connection(&emit, ConnectionState::Offline);
            tokio::time::sleep(Duration::from_secs(backoff_secs(failures))).await;
        }
    }
}

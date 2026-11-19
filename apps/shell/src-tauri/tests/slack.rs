mod common;
use common::*;
use rosetta_shell_lib::error::{ShellError, SlackError};
use rosetta_shell_lib::auth::store::{MemoryStore, SessionStore, StoredSession};
use rosetta_shell_lib::files::{is_allowed_slackfile_url, target_from_path};
use rosetta_shell_lib::slack::api::{Credentials, SlackApi};
use rosetta_shell_lib::slack::client::params;
use rosetta_shell_lib::slack::model::*;
use rosetta_shell_lib::slack::realtime::{parse_rtm_event, poll_once, Emit};
use rosetta_shell_lib::slack::transport::{HttpTransport, ReqwestTransport};
use rosetta_shell_lib::state::AppState;
use serde_json::json;
use std::sync::{Arc, Mutex};
use tokio::time::{Duration, Instant};

#[tokio::test]
async fn bootstrap_pages_conversations_and_merges_counts() {
    let t = RecordingTransport::new(vec![
        ok(fixture!("auth_test.json")),
        ok(fixture!("users_conversations_p1.json")),
        ok(fixture!("users_conversations_p2.json")),
        ok(fixture!("client_counts.json")),
        ok(fixture!("users_info_self.json")),
        ok(fixture!("users_info_bob.json")),
    ]);
    let b = api(&t).bootstrap().await.unwrap();

    assert_eq!(t.methods(), ["auth.test", "users.conversations", "users.conversations", "client.counts", "users.info", "users.info"]);
    assert_eq!(t.request(1).param("types"), Some("public_channel,private_channel,mpim,im"));
    assert_eq!(t.request(1).param("exclude_archived"), Some("true"));
    assert_eq!(t.request(1).param("limit"), Some("200"));
    assert_eq!(t.request(1).param("cursor"), None);
    assert_eq!(t.request(2).param("cursor"), Some("dGVhbTpDMDYxRkE1UEI="));
    assert_eq!(t.request(4).param("user"), Some(SELF_ID));
    assert_eq!(t.request(5).param("user"), Some("U0BOB0001"));

    assert_eq!(b.team, Team { id: "T024BE7LD".into(), name: "Acme".into(), url: Some("https://acme.slack.com/".into()) });
    assert_eq!(b.self_user.name, "alice.c");
    let kinds: Vec<_> = b.conversations.iter().map(|c| (c.id.as_str(), c.kind)).collect();
    assert_eq!(
        kinds,
        [
            ("C012AB3CD", ConversationKind::Channel),
            ("G0123SECRET", ConversationKind::Private),
            ("D0123ABCD", ConversationKind::Im),
            ("G0MPDM001", ConversationKind::Mpim)
        ]
    );
    let general = &b.conversations[0];
    assert_eq!((general.unread, general.mentions), (1, 2));
    assert_eq!(general.last_read.as_deref(), Some("1700000100.000100"));
    assert_eq!(general.topic.as_deref(), Some("公司公告"));
    assert_eq!(general.member_count, Some(42));
    let secret = &b.conversations[1];
    assert_eq!((secret.unread, secret.mentions), (0, 0));
    let im = &b.conversations[2];
    assert_eq!((im.unread, im.mentions), (3, 3));
    assert_eq!(im.user_id.as_deref(), Some("U0BOB0001"));
    assert_eq!(im.name, "U0BOB0001");
    assert_eq!(b.conversations[3].unread, 1);
    // display_name 為空時退到 real_name
    assert_eq!(b.users.iter().find(|u| u.id == "U0BOB0001").unwrap().name, "Bob Lin");
}

#[tokio::test]
async fn bootstrap_tolerates_unusable_client_counts() {
    let t = RecordingTransport::new(vec![
        ok(fixture!("auth_test.json")),
        ok(fixture!("users_conversations_p2.json")),
        ok(fixture!("unknown_method.json")),
        ok(fixture!("users_info_self.json")),
        ok(fixture!("users_info_bob.json")),
    ]);
    let b = api(&t).bootstrap().await.unwrap();
    assert!(b.conversations.iter().all(|c| c.unread == 0 && c.mentions == 0));
}

#[tokio::test]
async fn history_normalizes_and_orders_oldest_first() {
    let t = RecordingTransport::new(vec![ok(fixture!("conversations_history.json"))]);
    let page = api(&t).history("C012AB3CD", Some("cur"), 50, None).await.unwrap();
    assert_eq!(t.request(0).param("channel"), Some("C012AB3CD"));
    assert_eq!(t.request(0).param("cursor"), Some("cur"));
    assert_eq!(t.request(0).param("limit"), Some("50"));
    assert_eq!(page.next_cursor.as_deref(), Some("bmV4dF90czoxNjAw"));

    let ts: Vec<_> = page.items.iter().map(|m| m.ts.as_str()).collect();
    assert_eq!(ts, ["1700000100.000100", "1700000200.000200", "1700000300.000300"]);

    let bot = &page.items[0];
    assert_eq!(bot.bot_name.as_deref(), Some("CI Bot"));
    assert_eq!(bot.subtype.as_deref(), Some("bot_message"));
    assert_eq!(bot.user, None);
    assert!(!bot.edited);

    let file_msg = &page.items[1];
    assert!(file_msg.edited);
    let f = &file_msg.files[0];
    assert_eq!(f.thumb.as_deref(), Some("https://files.slack.com/files-tmb/T024BE7LD-F0123FILE1-abc/diagram_360.png"));
    assert_eq!((f.thumb_w, f.thumb_h), (Some(360), Some(240)));
    assert_eq!(f.url_private.as_deref(), Some("https://files.slack.com/files-pri/T024BE7LD-F0123FILE1/diagram.png"));

    let thread = &page.items[2];
    assert_eq!(thread.thread_ts.as_deref(), Some("1700000300.000300"));
    assert_eq!(thread.reply_count, 2);
    assert_eq!(thread.reply_users, ["U023BECGF", "U0BOB0001"]);
    assert_eq!(thread.latest_reply.as_deref(), Some("1700000400.000400"));
    let thumbs = thread.reactions.iter().find(|r| r.name == "thumbsup").unwrap();
    assert!(thumbs.me);
    assert_eq!(thumbs.count, 2);
    assert!(!thread.reactions.iter().find(|r| r.name == "eyes").unwrap().me);
}

#[tokio::test]
async fn contract_json_shape_matches_types_ts() {
    let t = RecordingTransport::new(vec![ok(fixture!("conversations_history.json"))]);
    let page = api(&t).history("C1", None, 3, None).await.unwrap();
    let v = serde_json::to_value(&page.items[2]).unwrap();
    for k in ["ts", "user", "bot_name", "text", "subtype", "thread_ts", "reply_count", "reply_users", "latest_reply", "edited", "reactions", "files"] {
        assert!(v.get(k).is_some(), "Message 缺欄位 {k}");
    }
    let ev = serde_json::to_value(RealtimeEvent::Connection { state: ConnectionState::Polling }).unwrap();
    assert_eq!(ev, json!({"type": "connection", "state": "polling"}));
    let ev = serde_json::to_value(RealtimeEvent::MessageChanged { channel: "C".into(), message: page.items[0].clone() }).unwrap();
    assert_eq!(ev["type"], "message_changed");
    let st = serde_json::to_value(AuthStatus::Invalid { reason: "x".into() }).unwrap();
    assert_eq!(st, json!({"state": "invalid", "reason": "x"}));
    assert_eq!(serde_json::to_value(AuthStatus::SignedOut).unwrap(), json!({"state": "signed_out"}));
    let e = serde_json::to_value(ShellError::from(SlackError::AuthInvalid)).unwrap();
    assert_eq!(e["code"], "auth_invalid");
    assert_eq!(serde_json::to_value(ConversationKind::Im).unwrap(), "im");
}

#[tokio::test]
async fn replies_follow_all_pages() {
    let t = RecordingTransport::new(vec![
        ok(r#"{"ok":true,"messages":[{"ts":"1.1","text":"root"},{"ts":"1.2","text":"a","thread_ts":"1.1"}],"has_more":true,"response_metadata":{"next_cursor":"n2"}}"#),
        ok(r#"{"ok":true,"messages":[{"ts":"1.3","text":"b","thread_ts":"1.1"}],"has_more":false}"#),
    ]);
    let m = api(&t).replies("C1", "1.1").await.unwrap();
    assert_eq!(m.iter().map(|m| m.ts.as_str()).collect::<Vec<_>>(), ["1.1", "1.2", "1.3"]);
    assert_eq!(t.request(1).param("cursor"), Some("n2"));
}

#[tokio::test(start_paused = true)]
async fn retries_429_waiting_retry_after() {
    let t = RecordingTransport::new(vec![status(429, Some(3), ""), ok(fixture!("ok.json"))]);
    let start = Instant::now();
    client(&t).call("auth.test", vec![]).await.unwrap();
    assert_eq!(start.elapsed(), Duration::from_secs(3));
    assert_eq!(t.requests.lock().unwrap().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn ratelimited_without_header_backs_off_exponentially() {
    let t = RecordingTransport::new(vec![ok(fixture!("ratelimited.json")), ok(fixture!("ratelimited.json")), ok(fixture!("ok.json"))]);
    let start = Instant::now();
    client(&t).call("x", vec![]).await.unwrap();
    assert_eq!(start.elapsed(), Duration::from_secs(1 + 2));
}

#[tokio::test(start_paused = true)]
async fn retries_exhausted_returns_rate_limited() {
    let t = RecordingTransport::new((0..8).map(|_| status(429, None, "")).collect());
    let start = Instant::now();
    let err = client(&t).call("x", vec![]).await.unwrap_err();
    assert_eq!(err, SlackError::RateLimited);
    assert_eq!(t.requests.lock().unwrap().len(), 5, "首次 + 4 次重試");
    assert_eq!(start.elapsed(), Duration::from_secs(1 + 2 + 4 + 8));
}

#[tokio::test(start_paused = true)]
async fn retry_after_is_capped_at_30s() {
    let t = RecordingTransport::new(vec![status(429, Some(600), ""), ok(fixture!("ok.json"))]);
    let start = Instant::now();
    client(&t).call("x", vec![]).await.unwrap();
    assert_eq!(start.elapsed(), Duration::from_secs(30));
}

#[tokio::test(start_paused = true)]
async fn server_errors_are_retried() {
    let t = RecordingTransport::new(vec![status(503, None, "oops"), ok(fixture!("ok.json"))]);
    client(&t).call("x", vec![]).await.unwrap();
    assert_eq!(t.requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn auth_errors_map_to_auth_invalid_and_others_to_api() {
    for code in ["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive"] {
        let t = RecordingTransport::new(vec![ok(&format!(r#"{{"ok":false,"error":"{code}"}}"#))]);
        assert_eq!(client(&t).call("x", vec![]).await.unwrap_err(), SlackError::AuthInvalid, "{code}");
    }
    let t = RecordingTransport::new(vec![ok(r#"{"ok":false,"error":"channel_not_found"}"#)]);
    assert_eq!(client(&t).call("x", vec![]).await.unwrap_err(), SlackError::Api("channel_not_found".into()));
    let t = RecordingTransport::new(vec![ok(fixture!("invalid_auth.json"))]);
    assert_eq!(api(&t).auth_test().await.unwrap_err(), SlackError::AuthInvalid);
}

#[tokio::test]
async fn post_react_and_upload_flow() {
    let t = RecordingTransport::new(vec![
        ok(fixture!("chat_post_message.json")),
        ok(r#"{"ok":false,"error":"already_reacted"}"#),
        ok(fixture!("upload_url.json")),
        ok(fixture!("ok.json")),
    ]);
    let a = api(&t);
    let m = a.post_message("C012AB3CD", "hello", Some("1700000000.000100")).await.unwrap();
    assert_eq!((m.ts.as_str(), m.text.as_str(), m.user.as_deref()), ("1700000500.000500", "hello", Some(SELF_ID)));
    assert_eq!(m.thread_ts.as_deref(), Some("1700000000.000100"));
    assert_eq!(t.request(0).param("thread_ts"), Some("1700000000.000100"));
    a.react("C012AB3CD", "1.1", "eyes", true).await.unwrap();
    assert_eq!(t.request(1).method, "reactions.add");
    a.upload_file("C012AB3CD", None, "a.txt", b"hello".to_vec()).await.unwrap();
    assert_eq!(t.request(2).method, "files.getUploadURLExternal");
    assert_eq!(t.request(2).param("length"), Some("5"));
    assert_eq!(t.uploads.lock().unwrap()[0], ("https://files.slack.com/upload/v1/ABC123".to_string(), 5));
    assert_eq!(t.request(3).method, "files.completeUploadExternal");
    assert_eq!(t.request(3).param("channel_id"), Some("C012AB3CD"));
    assert!(t.request(3).param("files").unwrap().contains("F0UPLOAD01"));
}

#[tokio::test]
async fn emoji_aliases_are_resolved() {
    let t = RecordingTransport::new(vec![ok(fixture!("emoji_list.json"))]);
    let m = api(&t).emoji_list().await.unwrap();
    assert_eq!(m["parrot"], m["partyparrot"]);
    assert!(m["bowtie"].ends_with("def.png"));
    assert_eq!(m["thumbs"], "alias:+1", "指向內建 emoji 的 alias 原樣保留");
}

// ---- 真正的 reqwest transport：用本機假伺服器確認 token 與 Cookie header ----

async fn capture_one_request(response_body: &'static str) -> (String, tokio::task::JoinHandle<String>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/api/", listener.local_addr().unwrap());
    let h = tokio::spawn(async move {
        let (mut s, _) = listener.accept().await.unwrap();
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let n = s.read(&mut chunk).await.unwrap();
            buf.extend_from_slice(&chunk[..n]);
            let text = String::from_utf8_lossy(&buf).to_string();
            if let Some(i) = text.find("\r\n\r\n") {
                let len = text[..i]
                    .lines()
                    .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap()))
                    .unwrap_or(0);
                if buf.len() >= i + 4 + len || n == 0 {
                    break;
                }
            }
            if n == 0 {
                break;
            }
        }
        let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response_body.len(), response_body);
        s.write_all(resp.as_bytes()).await.unwrap();
        String::from_utf8_lossy(&buf).to_string()
    });
    (base, h)
}

#[tokio::test]
async fn reqwest_transport_sends_token_form_field_and_cookie_header() {
    let (base, server) = capture_one_request(r#"{"ok":true}"#).await;
    let creds = Credentials { token: "xoxc-test".into(), cookie: Some("xoxd-ab+c/d%2Be".into()), api_base: base };
    let t = ReqwestTransport::new(creds);
    let resp = t.post_form("conversations.mark", &params(&[("channel", "C1"), ("ts", "1.2")])).await.unwrap();
    assert_eq!(resp.status, 200);
    let raw = server.await.unwrap();
    let lower = raw.to_ascii_lowercase();
    assert!(lower.starts_with("post /api/conversations.mark "), "{raw}");
    assert!(lower.contains("cookie: d=xoxd-ab%2bc%2fd%2be\r\n"), "{raw}");
    let body = raw.split("\r\n\r\n").nth(1).unwrap();
    assert!(body.contains("token=xoxc-test"), "{body}");
    assert!(body.contains("channel=C1") && body.contains("ts=1.2"));
}

#[tokio::test]
async fn reqwest_transport_without_cookie_sends_no_cookie_header() {
    let (base, server) = capture_one_request(r#"{"ok":true}"#).await;
    let t = ReqwestTransport::new(Credentials { token: "xoxp-test".into(), cookie: None, api_base: base });
    t.post_form("auth.test", &vec![]).await.unwrap();
    assert!(!server.await.unwrap().to_ascii_lowercase().contains("cookie:"));
}

#[tokio::test]
async fn reqwest_transport_refuses_non_slack_download_urls() {
    let t = ReqwestTransport::new(Credentials { token: "xoxc-test".into(), cookie: Some("c".into()), api_base: "http://127.0.0.1:9/api/".into() });
    assert_eq!(t.get_bytes("https://evil.example.com/x.png").await.err(), Some(SlackError::Api("forbidden_url".into())));
}

#[test]
fn credentials_debug_hides_secrets() {
    let c = Credentials::new("xoxc-super-secret".into(), Some("xoxd-cookie-secret".into()), Some("https://acme.slack.com/"));
    let d = format!("{c:?}");
    assert!(!d.contains("super-secret") && !d.contains("cookie-secret"), "{d}");
    assert_eq!(c.api_base, "https://acme.slack.com/api/");
    assert_eq!(Credentials::new("t".into(), None, None).api_base, "https://slack.com/api/");
    assert_eq!(Credentials::new("t".into(), None, Some("https://app.slack.com/")).api_base, "https://slack.com/api/");
    assert_eq!(Credentials::new("t".into(), None, Some("https://evil.com/")).api_base, "https://slack.com/api/");
    let s = StoredSession { team_id: "T".into(), team_name: "n".into(), team_url: None, user_id: "U".into(), token: "xoxc-super-secret".into(), cookie: Some("xoxd-cookie-secret".into()) };
    let d = format!("{s:?}");
    assert!(!d.contains("super-secret") && !d.contains("cookie-secret"), "{d}");
}

#[test]
fn memory_store_roundtrip() {
    let store = MemoryStore::default();
    assert_eq!(store.load().unwrap(), None);
    let s = StoredSession { team_id: "T".into(), team_name: "n".into(), team_url: None, user_id: "U".into(), token: "xoxc-test".into(), cookie: None };
    store.save(&s).unwrap();
    assert_eq!(store.load().unwrap(), Some(s));
    store.delete().unwrap();
    assert_eq!(store.load().unwrap(), None);
}

#[test]
fn slackfile_allowlist() {
    for ok in [
        "https://files.slack.com/files-pri/T1-F1/a.png",
        "https://slack.com/x",
        "https://avatars.slack-edge.com/a.png",
        "https://files.slack-files.com/x",
    ] {
        assert!(is_allowed_slackfile_url(ok), "{ok}");
    }
    for bad in [
        "http://files.slack.com/a.png",
        "https://evilslack.com/a.png",
        "https://slack.com.evil.com/a.png",
        "https://files.slack.com@evil.com/a.png",
        "https://user:pw@files.slack.com/a.png",
        "https://files.slack.com:8443/a.png",
        "https://evil.com/files.slack.com",
        "file:///etc/passwd",
        "not a url",
        "",
    ] {
        assert!(!is_allowed_slackfile_url(bad), "{bad}");
    }
    let enc = "https%3A%2F%2Ffiles.slack.com%2Ffiles-pri%2FT1-F1%2Fa.png%3Fx%3D1";
    assert_eq!(target_from_path(&format!("/{enc}")).as_deref(), Some("https://files.slack.com/files-pri/T1-F1/a.png?x=1"));
    assert_eq!(target_from_path("/"), None);
}

// ---- 即時事件 ----

fn rtm(v: serde_json::Value) -> Option<RealtimeEvent> {
    parse_rtm_event(&v, SELF_ID)
}

#[test]
fn rtm_message_variants() {
    let Some(RealtimeEvent::Message { channel, message }) = rtm(json!({
        "type":"message","channel":"C1","user":"U2","text":"hi","ts":"1.5","team":"T1",
        "reactions":[{"name":"x","users":[SELF_ID],"count":1}]
    })) else { panic!() };
    assert_eq!((channel.as_str(), message.text.as_str()), ("C1", "hi"));
    assert!(message.reactions[0].me);

    let Some(RealtimeEvent::MessageChanged { channel, message }) = rtm(json!({
        "type":"message","subtype":"message_changed","channel":"C1","hidden":true,"ts":"1.9",
        "message":{"type":"message","user":"U2","text":"edited","ts":"1.5","edited":{"user":"U2","ts":"1.9"}},
        "previous_message":{"text":"hi","ts":"1.5"}
    })) else { panic!() };
    assert_eq!(channel, "C1");
    assert!(message.edited && message.text == "edited" && message.ts == "1.5");

    assert_eq!(
        rtm(json!({"type":"message","subtype":"message_deleted","channel":"C1","deleted_ts":"1.5","ts":"1.10","hidden":true})),
        Some(RealtimeEvent::MessageDeleted { channel: "C1".into(), ts: "1.5".into() })
    );

    let Some(RealtimeEvent::MessageChanged { message, .. }) = rtm(json!({
        "type":"message","subtype":"message_replied","hidden":true,"channel":"C1","ts":"2.0",
        "message":{"type":"message","user":"U2","text":"root","ts":"1.1","thread_ts":"1.1","reply_count":3,"reply_users":["U2"],"latest_reply":"2.0"}
    })) else { panic!() };
    assert_eq!((message.ts.as_str(), message.reply_count), ("1.1", 3));

    // 其他隱藏訊息與沒有 channel 的 frame 忽略
    assert_eq!(rtm(json!({"type":"message","subtype":"bot_message_hidden","hidden":true,"channel":"C1","ts":"3.0"})), None);
    assert_eq!(rtm(json!({"type":"message","ts":"3.0"})), None);
}

#[test]
fn rtm_reactions_and_marks_and_noise() {
    assert_eq!(
        rtm(json!({"type":"reaction_added","user":"U2","reaction":"thumbsup","item":{"type":"message","channel":"C1","ts":"1.5"},"event_ts":"2.0"})),
        Some(RealtimeEvent::Reaction { channel: "C1".into(), ts: "1.5".into(), name: "thumbsup".into(), user: "U2".into(), added: true })
    );
    let Some(RealtimeEvent::Reaction { added, .. }) =
        rtm(json!({"type":"reaction_removed","user":"U2","reaction":"x","item":{"type":"message","channel":"C1","ts":"1.5"}})) else { panic!() };
    assert!(!added);
    assert_eq!(rtm(json!({"type":"reaction_added","user":"U2","reaction":"x","item":{"type":"file","file":"F1"}})), None);

    for ty in ["channel_marked", "group_marked", "im_marked", "mpim_marked"] {
        assert_eq!(
            rtm(json!({"type":ty,"channel":"C1","ts":"1.5","unread_count":4,"unread_count_display":3,"mention_count_display":1})),
            Some(RealtimeEvent::Marked { channel: "C1".into(), ts: "1.5".into(), unread: 3, mentions: 1 })
        );
    }
    for noise in [json!({"type":"hello"}), json!({"type":"pong","reply_to":1}), json!({"type":"user_typing","channel":"C1","user":"U2"}), json!({"ok":true,"reply_to":1}), json!("x")] {
        assert_eq!(rtm(noise), None);
    }
}

#[tokio::test]
async fn polling_seeds_then_emits_only_new_messages() {
    let t = RecordingTransport::new(vec![
        ok(r#"{"ok":true,"messages":[{"ts":"10.1","text":"seed"}]}"#),
        ok(r#"{"ok":true,"messages":[{"ts":"12.1","text":"two"},{"ts":"11.1","text":"one"},{"ts":"10.1","text":"seed"}]}"#),
        ok(r#"{"ok":true,"messages":[]}"#),
    ]);
    let a: Arc<dyn SlackApi> = Arc::new(api(&t));
    let got: Arc<Mutex<Vec<RealtimeEvent>>> = Default::default();
    let sink = got.clone();
    let emit: Emit = Arc::new(move |e| sink.lock().unwrap().push(e));
    let tracker = rosetta_shell_lib::slack::realtime::Tracker::default();

    poll_once(&a, &emit, &tracker, "C1").await.unwrap();
    assert!(got.lock().unwrap().is_empty());
    poll_once(&a, &emit, &tracker, "C1").await.unwrap();
    assert_eq!(t.request(1).param("oldest"), Some("10.1"));
    let texts: Vec<_> = got.lock().unwrap().iter().map(|e| match e { RealtimeEvent::Message { message, .. } => message.text.clone(), _ => String::new() }).collect();
    assert_eq!(texts, ["one", "two"], "由舊到新，且不重發 seed");
    poll_once(&a, &emit, &tracker, "C1").await.unwrap();
    assert_eq!(t.request(2).param("oldest"), Some("12.1"));
}

#[test]
fn write_commands_are_rejected_in_read_only_mode_and_allowed_when_off() {
    let store = Arc::new(MemoryStore::default());
    store
        .save(&StoredSession { team_id: "T".into(), team_name: "n".into(), team_url: None, user_id: "U".into(), token: "xoxc-test".into(), cookie: None })
        .unwrap();
    let state = AppState::new(store);
    // 預設就是唯讀
    assert!(state.is_read_only());
    let err = state.write_api().err().expect("read-only must refuse");
    assert_eq!(err.code, "read_only");
    assert!(err.message.contains("唯讀"));
    // 關掉唯讀才放行
    state.set_read_only(false);
    assert!(state.write_api().is_ok());
    // 再打開又擋住
    state.set_read_only(true);
    assert_eq!(state.write_api().err().unwrap().code, "read_only");
}


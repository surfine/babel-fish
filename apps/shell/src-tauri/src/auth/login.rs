//! 網頁版登入：開一個 Slack 網頁視窗，從它的 localStorage 取 xoxc 權杖、從 WebView cookie 取 `d`。
//!
//! 安全約定：token、cookie 絕不進 log、錯誤訊息或事件 payload；不讀 Chrome 的 cookie。
//! 登入視窗不在任何 capability 內，遠端頁面無法 invoke。
//!
//! 假設（未用真 Slack 驗證）：`localConfig_v2` 的 JSON 形如
//! `{"teams": {"T123": {"name", "url", "token": "xoxc-…", "user_id"}}, "lastActiveTeamId": "T123"}`。
use super::store::StoredSession;
use crate::state::{build_api, AppState};
use crate::{error::SlackError, slack::model::{AuthStatus, Team}};
use percent_encoding::percent_decode_str;
use serde::Deserialize;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LOGIN_LABEL: &str = "slack-login";
const CAPTURE_HOST: &str = "rosetta-capture.invalid";

pub const INIT_SCRIPT: &str = r#"
(function () {
  if (window.top !== window || location.hostname !== 'app.slack.com') return;
  var sent = false;
  setInterval(function () {
    if (sent) return;
    try {
      var raw = localStorage.getItem('localConfig_v2');
      if (!raw) return;
      var cfg = JSON.parse(raw);
      var teams = cfg.teams || {};
      var ids = Object.keys(teams).filter(function (id) {
        return teams[id] && typeof teams[id].token === 'string' && teams[id].token.indexOf('xoxc-') === 0;
      });
      if (!ids.length) return;
      var id = ids.indexOf(cfg.lastActiveTeamId) >= 0 ? cfg.lastActiveTeamId : ids[0];
      var t = teams[id];
      var payload = { team_id: id, team_name: t.name || '', team_url: t.url || '', user_id: t.user_id || '', token: t.token };
      sent = true;
      setTimeout(function () { sent = false; }, 15000);
      location.href = 'https://rosetta-capture.invalid/#' + encodeURIComponent(JSON.stringify(payload));
    } catch (e) {}
  }, 1000);
})();
"#;

#[derive(Deserialize)]
pub struct Capture {
    pub team_id: String,
    #[serde(default)]
    pub team_name: String,
    #[serde(default)]
    pub team_url: String,
    #[serde(default)]
    pub user_id: String,
    pub token: String,
}

/// 解析導覽網址：不是 capture 主機回 None；是但內容無效回 Some(Err)。
pub fn parse_capture(url: &url::Url) -> Option<Result<Capture, ()>> {
    if url.host_str() != Some(CAPTURE_HOST) {
        return None;
    }
    let parsed = url
        .fragment()
        .and_then(|f| percent_decode_str(f).decode_utf8().ok())
        .and_then(|j| serde_json::from_str::<Capture>(&j).ok())
        .filter(|c| c.token.starts_with("xoxc-") && !c.team_id.is_empty())
        .ok_or(());
    Some(parsed)
}

fn login_error(app: &AppHandle, msg: &str) {
    let _ = app.emit("auth://login_error", serde_json::json!({ "message": msg }));
}

pub fn begin(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(LOGIN_LABEL) {
        let _ = w.set_focus();
        return Ok(());
    }
    let nav_app = app.clone();
    // 未登入時 app.slack.com 會轉到行銷首頁，所以直接開登入頁；登入完成後 Slack 會導回 app.slack.com，擷取腳本在那裡執行
    WebviewWindowBuilder::new(app, LOGIN_LABEL, WebviewUrl::External("https://slack.com/signin".parse().unwrap()))
        .title("登入 Slack")
        .user_agent(crate::slack::transport::SAFARI_UA)
        .inner_size(1000.0, 760.0)
        .initialization_script(INIT_SCRIPT)
        .on_navigation(move |url| match parse_capture(url) {
            None => true,
            Some(parsed) => {
                // 不在同步回呼裡阻塞：交給 async 任務處理，並取消這次導覽
                let app = nav_app.clone();
                tauri::async_runtime::spawn(async move {
                    match parsed {
                        Ok(capture) => complete(app, capture).await,
                        Err(()) => login_error(&app, "擷取到的登入資料格式不正確，請再試一次"),
                    }
                });
                false
            }
        })
        .build()
        .map(|_| ())
        .map_err(|e| format!("無法開啟登入視窗：{e}"))
}

async fn find_d_cookie(app: &AppHandle) -> Option<String> {
    let w = app.get_webview_window(LOGIN_LABEL)?;
    for u in ["https://app.slack.com", "https://slack.com"] {
        let Ok(url) = u.parse::<url::Url>() else { continue };
        if let Ok(cookies) = w.cookies_for_url(url) {
            if let Some(c) = cookies.iter().find(|c| c.name() == "d" && !c.value().is_empty()) {
                return Some(c.value().to_string());
            }
        }
    }
    None
}

async fn complete(app: AppHandle, capture: Capture) {
    let state = app.state::<Arc<AppState>>();
    if state.login_busy.swap(true, Ordering::SeqCst) {
        return;
    }
    let result = verify_and_store(&app, &state, capture).await;
    state.login_busy.store(false, Ordering::SeqCst);
    match result {
        Ok(status) => {
            if let Some(w) = app.get_webview_window(LOGIN_LABEL) {
                let _ = w.close();
            }
            let _ = app.emit("auth://changed", status);
        }
        Err(msg) => login_error(&app, &msg),
    }
}

async fn verify_and_store(app: &AppHandle, state: &AppState, c: Capture) -> Result<AuthStatus, String> {
    let cookie = find_d_cookie(app).await.ok_or("找不到登入 cookie（d），請確認已在視窗中完成登入後再試")?;
    let mut session = StoredSession {
        team_id: c.team_id,
        team_name: c.team_name,
        team_url: Some(c.team_url).filter(|u| !u.is_empty()),
        user_id: c.user_id,
        token: c.token,
        cookie: Some(cookie),
    };
    let api = build_api(&session);
    let info = api.auth_test().await.map_err(|e| match e {
        SlackError::AuthInvalid => "Slack 拒絕了這組登入資訊，請重新登入".to_string(),
        other => other.to_string(),
    })?;
    session.user_id = info.user_id.clone();
    if !info.team_id.is_empty() {
        session.team_id = info.team_id;
    }
    if !info.team.is_empty() {
        session.team_name = info.team;
    }
    if info.url.is_some() {
        session.team_url = info.url;
    }
    state.store.save(&session).map_err(|e| e.to_string())?;
    state.set_api(Some(build_api(&session)));
    Ok(AuthStatus::SignedIn {
        team: Team { id: session.team_id, name: session.team_name, url: session.team_url },
        user_id: session.user_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nav(frag: &str) -> url::Url {
        format!("https://rosetta-capture.invalid/#{frag}").parse().unwrap()
    }

    #[test]
    fn parses_capture_fragment() {
        let json = r#"{"team_id":"T1","team_name":"Acme","team_url":"https://acme.slack.com/","user_id":"U1","token":"xoxc-test"}"#;
        let enc: String = url::form_urlencoded::byte_serialize(json.as_bytes()).collect();
        let c = parse_capture(&nav(&enc)).unwrap().unwrap();
        assert_eq!((c.team_id.as_str(), c.user_id.as_str()), ("T1", "U1"));
    }

    #[test]
    fn rejects_bad_payloads_and_ignores_other_hosts() {
        assert!(parse_capture(&"https://app.slack.com/client".parse().unwrap()).is_none());
        assert!(parse_capture(&nav("%7B%7D")).unwrap().is_err());
        let not_xoxc = r#"{"team_id":"T1","token":"xoxp-1"}"#;
        let enc: String = url::form_urlencoded::byte_serialize(not_xoxc.as_bytes()).collect();
        assert!(parse_capture(&nav(&enc)).unwrap().is_err());
    }

    #[test]
    fn init_script_targets_slack_only_and_uses_capture_host() {
        assert!(INIT_SCRIPT.contains("app.slack.com") && INIT_SCRIPT.contains(CAPTURE_HOST));
    }
}

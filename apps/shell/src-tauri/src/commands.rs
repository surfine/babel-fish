use crate::auth::login;
use crate::error::{ShellError, SlackError};
use crate::slack::model::*;
use crate::slack::realtime;
use crate::state::AppState;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

type St<'a> = State<'a, Arc<AppState>>;
type Res<T> = Result<T, ShellError>;

#[tauri::command]
pub async fn auth_status(app: AppHandle, state: St<'_>) -> Res<AuthStatus> {
    let stored = state.store.load().map_err(|e| state.fail(&app, e))?;
    let Some(stored) = stored else { return Ok(AuthStatus::SignedOut) };
    let api = state.api().map_err(|e| state.fail(&app, e))?;
    match api.auth_test().await {
        Ok(info) => Ok(AuthStatus::SignedIn {
            team: Team {
                id: if info.team_id.is_empty() { stored.team_id } else { info.team_id },
                name: if info.team.is_empty() { stored.team_name } else { info.team },
                url: info.url.or(stored.team_url),
            },
            user_id: info.user_id,
        }),
        Err(SlackError::AuthInvalid) => {
            state.mark_invalid(&app);
            Ok(AuthStatus::Invalid { reason: "Slack 登入已失效，請重新登入".into() })
        }
        // 離線等暫時性錯誤：沿用鑰匙圈裡的資料，讓前端先進得去
        Err(_) => Ok(AuthStatus::SignedIn {
            team: Team { id: stored.team_id, name: stored.team_name, url: stored.team_url },
            user_id: stored.user_id,
        }),
    }
}

#[tauri::command]
pub async fn auth_begin_login(app: AppHandle) -> Res<()> {
    login::begin(&app).map_err(|message| ShellError { code: "internal", message })
}

/// 只清除本機鑰匙圈與記憶體中的 session；不呼叫 auth.revoke（那會把瀏覽器裡的登入也登出）。
#[tauri::command]
pub async fn auth_logout(app: AppHandle, state: St<'_>) -> Res<()> {
    state.set_realtime(None);
    state.set_api(None);
    state.store.delete().map_err(ShellError::from)?;
    if let Some(w) = app.get_webview_window(login::LOGIN_LABEL) {
        let _ = w.close();
    }
    let _ = app.emit("auth://changed", AuthStatus::SignedOut);
    Ok(())
}

#[tauri::command]
pub async fn slack_bootstrap(app: AppHandle, state: St<'_>) -> Res<Bootstrap> {
    state.with_api(&app, |a| async move { a.bootstrap().await }).await
}

#[tauri::command]
pub async fn slack_history(app: AppHandle, state: St<'_>, channel: String, cursor: Option<String>, limit: Option<u32>) -> Res<Page<Message>> {
    state
        .with_api(&app, |a| async move { a.history(&channel, cursor.as_deref(), limit.unwrap_or(50).clamp(1, 200), None).await })
        .await
}

#[tauri::command]
pub async fn slack_replies(app: AppHandle, state: St<'_>, channel: String, ts: String) -> Res<Vec<Message>> {
    state.with_api(&app, |a| async move { a.replies(&channel, &ts).await }).await
}

#[tauri::command]
pub async fn slack_users_info(app: AppHandle, state: St<'_>, ids: Vec<String>) -> Res<Vec<User>> {
    state.with_api(&app, |a| async move { a.users_info(&ids).await }).await
}

#[tauri::command]
pub async fn slack_post(app: AppHandle, state: St<'_>, channel: String, text: String, thread_ts: Option<String>) -> Res<Message> {
    state.with_write_api(&app, |a| async move { a.post_message(&channel, &text, thread_ts.as_deref()).await }).await
}

#[tauri::command]
pub async fn slack_update(app: AppHandle, state: St<'_>, channel: String, ts: String, text: String) -> Res<()> {
    state.with_write_api(&app, |a| async move { a.update_message(&channel, &ts, &text).await }).await
}

#[tauri::command]
pub async fn slack_delete(app: AppHandle, state: St<'_>, channel: String, ts: String) -> Res<()> {
    state.with_write_api(&app, |a| async move { a.delete_message(&channel, &ts).await }).await
}

#[tauri::command]
pub async fn slack_react(app: AppHandle, state: St<'_>, channel: String, ts: String, name: String, add: bool) -> Res<()> {
    state.with_write_api(&app, |a| async move { a.react(&channel, &ts, &name, add).await }).await
}

#[tauri::command]
pub async fn slack_mark(app: AppHandle, state: St<'_>, channel: String, ts: String) -> Res<()> {
    state.with_write_api(&app, |a| async move { a.mark(&channel, &ts).await }).await
}

#[tauri::command]
pub async fn slack_upload(app: AppHandle, state: St<'_>, channel: String, thread_ts: Option<String>, filename: String, bytes: Vec<u8>) -> Res<()> {
    state
        .with_write_api(&app, |a| async move { a.upload_file(&channel, thread_ts.as_deref(), &filename, bytes).await })
        .await
}

/// 前端啟動與切換設定時同步唯讀模式。
#[tauri::command]
pub async fn set_read_only(state: St<'_>, on: bool) -> Res<()> {
    state.set_read_only(on);
    Ok(())
}

#[tauri::command]
pub async fn slack_emoji_list(app: AppHandle, state: St<'_>) -> Res<HashMap<String, String>> {
    state.with_api(&app, |a| async move { a.emoji_list().await }).await
}

#[tauri::command]
pub async fn realtime_start(app: AppHandle, state: St<'_>) -> Res<()> {
    let api = state.api().map_err(|e| state.fail(&app, e))?;
    let rx = state.active.subscribe();
    let emit_app = app.clone();
    let emit: realtime::Emit = Arc::new(move |ev| {
        let _ = emit_app.emit("slack://event", &ev);
    });
    let task_app = app.clone();
    let handle = tauri::async_runtime::spawn(async move {
        if let Err(SlackError::AuthInvalid) = realtime::run(api, emit, rx).await {
            task_app.state::<Arc<AppState>>().mark_invalid(&task_app);
        }
    });
    state.set_realtime(Some(handle));
    Ok(())
}

#[tauri::command]
pub async fn realtime_set_active(state: St<'_>, channel: Option<String>) -> Res<()> {
    state.active.send_replace(channel);
    Ok(())
}

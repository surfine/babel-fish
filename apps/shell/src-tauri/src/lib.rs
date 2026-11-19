pub mod auth;
mod commands;
pub mod error;
pub mod files;
pub mod guide;
pub mod llm;
pub mod menu;
pub mod slack;
pub mod state;
pub mod vault;

use state::AppState;
use std::sync::Arc;
use tauri::http::Response;
use tauri::Manager;

fn plain(status: u16, msg: &str) -> Response<Vec<u8>> {
    Response::builder().status(status).header("Content-Type", "text/plain; charset=utf-8").body(msg.as_bytes().to_vec()).unwrap()
}

/// plugins.updater 有公鑰與至少一個更新網址才算設定好
pub fn updater_configured(plugins: &std::collections::HashMap<String, serde_json::Value>) -> bool {
    let Some(u) = plugins.get("updater") else { return false };
    let has_key = u.get("pubkey").and_then(|v| v.as_str()).is_some_and(|k| !k.trim().is_empty());
    let has_endpoint = u.get("endpoints").and_then(|v| v.as_array()).is_some_and(|a| !a.is_empty());
    has_key && has_endpoint
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        // 選單列先用台灣正體；前端啟動後呼叫 set_ui_locale 換成使用者選的語言（menu.rs）
        .menu(|handle| menu::build(handle, "zh-TW"))
        .on_menu_event(|app, event| {
            if event.id() == "settings" {
                use tauri::Emitter;
                let _ = app.emit_to("main", "menu://settings", ());
            }
        })
        .setup(|app| {
            // 自動更新只在發行版建置時啟用：scripts/release.sh 用 --config 併入 plugins.updater（公鑰與 GitHub Releases 網址）。
            // 開發版沒有這段設定，就不註冊 updater，前端的檢查會直接略過。
            if updater_configured(&app.config().plugins.0) {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            Ok(())
        })
        .manage(Arc::new(AppState::new(Arc::new(vault::VaultSessionStore(vault::global())))))
        .manage(guide::GuideState::default())
        .register_asynchronous_uri_scheme_protocol("slackfile", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let target = files::target_from_path(request.uri().path());
            tauri::async_runtime::spawn(async move {
                let resp = match target {
                    Some(url) if files::is_allowed_slackfile_url(&url) => {
                        let state = app.state::<Arc<AppState>>();
                        match state.api() {
                            Err(_) => plain(401, "not signed in"),
                            Ok(api) => match api.fetch_file(&url).await {
                                Ok(r) if (200..300).contains(&r.status) => Response::builder()
                                    .status(200)
                                    .header("Content-Type", r.content_type.unwrap_or_else(|| "application/octet-stream".into()))
                                    .header("Cache-Control", "private, max-age=3600")
                                    .body(r.bytes)
                                    .unwrap(),
                                Ok(r) if r.status == 401 || r.status == 403 => plain(401, "unauthorized"),
                                Ok(r) if r.status == 404 => plain(404, "not found"),
                                Ok(_) => plain(502, "upstream error"),
                                Err(error::SlackError::AuthInvalid) => {
                                    state.mark_invalid(&app);
                                    plain(401, "auth invalid")
                                }
                                Err(_) => plain(502, "fetch failed"),
                            },
                        }
                    }
                    _ => plain(403, "forbidden"),
                };
                responder.respond(resp);
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth_status,
            commands::auth_begin_login,
            commands::auth_logout,
            commands::slack_bootstrap,
            commands::slack_history,
            commands::slack_replies,
            commands::slack_users_info,
            commands::slack_post,
            commands::slack_update,
            commands::slack_delete,
            commands::slack_react,
            commands::slack_mark,
            commands::slack_upload,
            commands::set_read_only,
            commands::slack_emoji_list,
            commands::realtime_start,
            commands::realtime_set_active,
            llm::llm_http,
            llm::llm_key_status,
            llm::llm_key_set,
            guide::guide_open,
            guide::guide_data,
            guide::guide_sent,
            guide::guide_close,
            menu::set_ui_locale,
            guide::guide_resize,
            guide::guide_copy_again,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Babel Fish");
}

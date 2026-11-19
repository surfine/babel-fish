use crate::auth::store::{SessionStore, StoredSession};
use crate::error::{ShellError, SlackError};
use crate::slack::api::{Credentials, SlackApi, WebSessionSlack};
use crate::slack::client::SlackClient;
use crate::slack::transport::ReqwestTransport;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

pub struct AppState {
    pub store: Arc<dyn SessionStore>,
    api: Mutex<Option<Arc<dyn SlackApi>>>,
    realtime: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    pub active: watch::Sender<Option<String>>,
    pub login_busy: AtomicBool,
    /// 唯讀模式：開著時所有會寫入 Slack 的命令一律拒絕。預設開（前端啟動時再依設定同步）。
    read_only: AtomicBool,
}

pub fn build_api(s: &StoredSession) -> Arc<dyn SlackApi> {
    let creds = Credentials::new(s.token.clone(), s.cookie.clone(), s.team_url.as_deref());
    let client = SlackClient::new(Arc::new(ReqwestTransport::new(creds)));
    Arc::new(WebSessionSlack::new(client, s.user_id.clone(), s.cookie.clone()))
}

impl AppState {
    pub fn new(store: Arc<dyn SessionStore>) -> Self {
        AppState {
            store,
            api: Mutex::new(None),
            realtime: Mutex::new(None),
            active: watch::channel(None).0,
            login_busy: AtomicBool::new(false),
            read_only: AtomicBool::new(true),
        }
    }

    /// 目前 session 的 API；沒有快取就從鑰匙圈載入。
    pub fn api(&self) -> Result<Arc<dyn SlackApi>, SlackError> {
        if let Some(a) = self.api.lock().unwrap().clone() {
            return Ok(a);
        }
        let s = self.store.load()?.ok_or(SlackError::NotSignedIn)?;
        let api = build_api(&s);
        *self.api.lock().unwrap() = Some(api.clone());
        Ok(api)
    }

    pub fn set_read_only(&self, on: bool) {
        self.read_only.store(on, Ordering::SeqCst);
    }

    pub fn is_read_only(&self) -> bool {
        self.read_only.load(Ordering::SeqCst)
    }

    /// 寫入類命令的入口：唯讀模式下直接拒絕，連 API 都不取。
    pub fn write_api(&self) -> Result<Arc<dyn SlackApi>, ShellError> {
        if self.is_read_only() {
            return Err(ShellError { code: "read_only", message: "唯讀模式已開啟，Babel Fish 不會對 Slack 寫入。到設定關掉唯讀模式才能傳送、修改或刪除。".into() });
        }
        self.api().map_err(ShellError::from)
    }

    pub fn set_api(&self, api: Option<Arc<dyn SlackApi>>) {
        *self.api.lock().unwrap() = api;
    }

    pub fn set_realtime(&self, h: Option<tauri::async_runtime::JoinHandle<()>>) {
        if let Some(old) = std::mem::replace(&mut *self.realtime.lock().unwrap(), h) {
            old.abort();
        }
    }

    /// 遇到錯誤時的共同處理：AuthInvalid 要通知前端並停掉即時連線。
    pub fn fail(&self, app: &AppHandle, e: SlackError) -> ShellError {
        if e == SlackError::AuthInvalid {
            self.mark_invalid(app);
        }
        e.into()
    }

    pub fn mark_invalid(&self, app: &AppHandle) {
        self.set_api(None);
        self.set_realtime(None);
        let _ = app.emit("auth://invalid", serde_json::json!({ "reason": "Slack 登入已失效，請重新登入" }));
    }

    pub async fn with_api<T, F, Fut>(&self, app: &AppHandle, f: F) -> Result<T, ShellError>
    where
        F: FnOnce(Arc<dyn SlackApi>) -> Fut,
        Fut: Future<Output = Result<T, SlackError>>,
    {
        let api = self.api().map_err(|e| self.fail(app, e))?;
        f(api).await.map_err(|e| self.fail(app, e))
    }
}

impl AppState {
    /// 寫入類命令用：唯讀檢查通過後才呼叫 Slack；AuthInvalid 的處理與 `with_api` 相同。
    pub async fn with_write_api<T, F, Fut>(&self, app: &AppHandle, f: F) -> Result<T, ShellError>
    where
        F: FnOnce(Arc<dyn SlackApi>) -> Fut,
        Fut: Future<Output = Result<T, SlackError>>,
    {
        let api = match self.write_api() {
            Ok(a) => a,
            Err(e) if e.code == "read_only" => return Err(e),
            Err(e) => {
                if e.code == "auth_invalid" {
                    self.mark_invalid(app);
                }
                return Err(e);
            }
        };
        f(api).await.map_err(|e| self.fail(app, e))
    }
}

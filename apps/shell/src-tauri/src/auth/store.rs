//! 登入工作階段的持久化。權杖與 cookie 只存在系統鑰匙圈，不落地到檔案。
use crate::error::SlackError;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub const KEYCHAIN_SERVICE: &str = "app.rosetta.shell";
pub const KEYCHAIN_ACCOUNT: &str = "slack-web-session";

#[derive(Clone, Serialize, Deserialize, PartialEq)]
pub struct StoredSession {
    pub team_id: String,
    pub team_name: String,
    pub team_url: Option<String>,
    pub user_id: String,
    pub token: String,
    pub cookie: Option<String>,
}

impl std::fmt::Debug for StoredSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StoredSession")
            .field("team_id", &self.team_id)
            .field("team_name", &self.team_name)
            .field("user_id", &self.user_id)
            .field("token", &"<redacted>")
            .field("cookie", &"<redacted>")
            .finish()
    }
}

pub trait SessionStore: Send + Sync {
    fn load(&self) -> Result<Option<StoredSession>, SlackError>;
    fn save(&self, session: &StoredSession) -> Result<(), SlackError>;
    fn delete(&self) -> Result<(), SlackError>;
}

pub struct KeychainStore;

impl KeychainStore {
    fn entry() -> Result<keyring::Entry, SlackError> {
        keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| SlackError::Internal(format!("keychain: {e}")))
    }
}

impl SessionStore for KeychainStore {
    fn load(&self) -> Result<Option<StoredSession>, SlackError> {
        match Self::entry()?.get_password() {
            Ok(json) => serde_json::from_str(&json)
                .map(Some)
                // 內容壞掉就當作沒登入，不把內容放進錯誤訊息
                .map_err(|_| SlackError::Internal("keychain: 已存的登入資料格式不正確".into())),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(SlackError::Internal(format!("keychain: {e}"))),
        }
    }

    fn save(&self, session: &StoredSession) -> Result<(), SlackError> {
        let json = serde_json::to_string(session).map_err(|e| SlackError::Internal(e.to_string()))?;
        Self::entry()?.set_password(&json).map_err(|e| SlackError::Internal(format!("keychain: {e}")))
    }

    fn delete(&self) -> Result<(), SlackError> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(SlackError::Internal(format!("keychain: {e}"))),
        }
    }
}

#[derive(Default)]
pub struct MemoryStore(Mutex<Option<StoredSession>>);

impl SessionStore for MemoryStore {
    fn load(&self) -> Result<Option<StoredSession>, SlackError> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn save(&self, session: &StoredSession) -> Result<(), SlackError> {
        *self.0.lock().unwrap() = Some(session.clone());
        Ok(())
    }
    fn delete(&self) -> Result<(), SlackError> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}


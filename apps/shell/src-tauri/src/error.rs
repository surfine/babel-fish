use serde::Serialize;
use std::fmt;

use crate::i18n::{tr, trf};

/// 內部錯誤。`ShellError`（序列化給前端）由它轉換。訊息跟著介面語言（i18n.rs）。
#[derive(Debug, Clone, PartialEq)]
pub enum SlackError {
    AuthInvalid,
    NotSignedIn,
    RateLimited,
    Api(String),
    Network(String),
    Internal(String),
}

impl fmt::Display for SlackError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            SlackError::AuthInvalid => tr("Slack 登入已失效"),
            SlackError::NotSignedIn => tr("尚未登入"),
            SlackError::RateLimited => tr("Slack 請求過於頻繁，請稍後再試"),
            SlackError::Api(e) => trf("Slack API 錯誤：{0}", &[e]),
            SlackError::Network(e) => trf("網路錯誤：{0}", &[e]),
            SlackError::Internal(e) => trf("內部錯誤：{0}", &[e]),
        };
        f.write_str(&s)
    }
}

impl std::error::Error for SlackError {}

/// 命令回傳給前端的錯誤，形狀見 types.ts 的 ShellError。
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ShellError {
    pub code: &'static str,
    pub message: String,
}

impl From<SlackError> for ShellError {
    fn from(e: SlackError) -> Self {
        let code = match &e {
            SlackError::AuthInvalid => "auth_invalid",
            SlackError::NotSignedIn => "not_signed_in",
            SlackError::RateLimited => "rate_limited",
            SlackError::Api(_) => "api",
            SlackError::Network(_) => "network",
            SlackError::Internal(_) => "internal",
        };
        ShellError { code, message: e.to_string() }
    }
}

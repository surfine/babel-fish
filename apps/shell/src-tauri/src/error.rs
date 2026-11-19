use serde::Serialize;

/// 內部錯誤。`ShellError`（序列化給前端）由它轉換。
#[derive(Debug, thiserror::Error, Clone, PartialEq)]
pub enum SlackError {
    #[error("Slack 登入已失效")]
    AuthInvalid,
    #[error("尚未登入")]
    NotSignedIn,
    #[error("Slack 請求過於頻繁，請稍後再試")]
    RateLimited,
    #[error("Slack API 錯誤：{0}")]
    Api(String),
    #[error("網路錯誤：{0}")]
    Network(String),
    #[error("內部錯誤：{0}")]
    Internal(String),
}

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

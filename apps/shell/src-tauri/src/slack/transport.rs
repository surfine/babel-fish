//! HTTP 傳輸層：把「帶權杖的表單 POST」與「抓檔案位元組」藏在 trait 後面，測試時換成錄製回放。
use crate::error::SlackError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// 登入視窗與 API 請求共用的 User-Agent。WKWebView 預設的 UA 沒有 `Version/… Safari/…`，
/// Slack 會判定成「不支援的瀏覽器」而不給登入；API 請求也用同一個，讓 Slack 看到的是同一個瀏覽器。
pub const SAFARI_UA: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15";

/// 一組 Slack 憑證。`cookie` 為 None 時代表官方 App 權杖（xoxp）——同一套實作直接可用。
#[derive(Clone, Serialize, Deserialize)]
pub struct Credentials {
    pub token: String,
    pub cookie: Option<String>,
    /// 形如 `https://acme.slack.com/api/`；沒有 workspace 網址時為 `https://slack.com/api/`。
    pub api_base: String,
}

impl Credentials {
    pub fn new(token: String, cookie: Option<String>, team_url: Option<&str>) -> Self {
        Credentials { token, cookie, api_base: api_base_from_team_url(team_url) }
    }
}

impl std::fmt::Debug for Credentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credentials")
            .field("token", &"<redacted>")
            .field("cookie", &self.cookie.as_ref().map(|_| "<redacted>"))
            .field("api_base", &self.api_base)
            .finish()
    }
}

pub fn api_base_from_team_url(team_url: Option<&str>) -> String {
    if let Some(u) = team_url.and_then(|t| url::Url::parse(t).ok()) {
        if u.scheme() == "https" {
            if let Some(h) = u.host_str() {
                if h.ends_with(".slack.com") && h != "app.slack.com" {
                    return format!("https://{h}/api/");
                }
            }
        }
    }
    "https://slack.com/api/".to_string()
}

#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub retry_after_secs: Option<u64>,
    pub body: String,
}

pub struct BytesResponse {
    pub status: u16,
    pub content_type: Option<String>,
    pub bytes: Vec<u8>,
}

pub type Params = Vec<(String, String)>;

#[async_trait]
pub trait HttpTransport: Send + Sync {
    async fn post_form(&self, method: &str, params: &Params) -> Result<HttpResponse, SlackError>;
    async fn get_bytes(&self, url: &str) -> Result<BytesResponse, SlackError>;
    async fn post_bytes(&self, url: &str, bytes: Vec<u8>) -> Result<u16, SlackError>;
}

pub struct ReqwestTransport {
    http: reqwest::Client,
    creds: Credentials,
}

impl ReqwestTransport {
    pub fn new(creds: Credentials) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(SAFARI_UA)
            .timeout(std::time::Duration::from_secs(60))
            // 帶 Cookie/權杖的請求只能在 Slack 網域內轉址，避免洩漏到別處
            .redirect(reqwest::redirect::Policy::custom(|a| {
                if a.previous().len() > 5 {
                    a.error("too many redirects")
                } else if a.url().scheme() == "https" && a.url().host_str().is_some_and(crate::files::is_allowed_host) {
                    a.follow()
                } else {
                    a.stop()
                }
            }))
            .build()
            .expect("reqwest client");
        ReqwestTransport { http, creds }
    }

    fn cookie_header(&self) -> Option<String> {
        self.creds.cookie.as_ref().map(|c| format!("d={}", urlencoding_encode(c)))
    }
}

/// 把 cookie 值做 URL 編碼（已編碼的 `%XX` 會原樣保留，避免二次編碼）。
pub fn urlencoding_encode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        let is_pct = b == b'%'
            && i + 2 < bytes.len()
            && bytes[i + 1].is_ascii_hexdigit()
            && bytes[i + 2].is_ascii_hexdigit();
        if is_pct || b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
        i += 1;
    }
    out
}

fn net(e: reqwest::Error) -> SlackError {
    // 不輸出 URL 以外的任何請求內容
    SlackError::Network(e.without_url().to_string())
}

#[async_trait]
impl HttpTransport for ReqwestTransport {
    async fn post_form(&self, method: &str, params: &Params) -> Result<HttpResponse, SlackError> {
        let mut form: Vec<(&str, &str)> = vec![("token", self.creds.token.as_str())];
        form.extend(params.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        let mut req = self.http.post(format!("{}{}", self.creds.api_base, method)).form(&form);
        if let Some(c) = self.cookie_header() {
            req = req.header("Cookie", c);
        }
        let resp = req.send().await.map_err(net)?;
        let status = resp.status().as_u16();
        let retry_after_secs = resp
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse().ok());
        let body = resp.text().await.map_err(net)?;
        Ok(HttpResponse { status, retry_after_secs, body })
    }

    async fn get_bytes(&self, url: &str) -> Result<BytesResponse, SlackError> {
        if !crate::files::is_allowed_slackfile_url(url) {
            return Err(SlackError::Api("forbidden_url".into()));
        }
        let mut req = self
            .http
            .get(url)
            .header("Authorization", format!("Bearer {}", self.creds.token));
        if let Some(c) = self.cookie_header() {
            req = req.header("Cookie", c);
        }
        let resp = req.send().await.map_err(net)?;
        let status = resp.status().as_u16();
        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let bytes = resp.bytes().await.map_err(net)?.to_vec();
        Ok(BytesResponse { status, content_type, bytes })
    }

    async fn post_bytes(&self, url: &str, bytes: Vec<u8>) -> Result<u16, SlackError> {
        if !crate::files::is_allowed_slackfile_url(url) {
            return Err(SlackError::Api("forbidden_url".into()));
        }
        let resp = self
            .http
            .post(url)
            .header("Content-Type", "application/octet-stream")
            .body(bytes)
            .send()
            .await
            .map_err(net)?;
        Ok(resp.status().as_u16())
    }
}

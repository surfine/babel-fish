//! LLM 供應商的 HTTP 代理與金鑰。
//! 前端（packages/llm）照常組請求，金鑰欄位只放佔位字串；這裡依供應商從鑰匙圈取出真金鑰換上，
//! 所以金鑰不會進到 webview。代理只放行已知的 LLM 端點，避免變成任意網址的轉送器。
use crate::error::{ShellError, SlackError};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use url::Url;

/// 前端放在 x-api-key／Authorization 裡的佔位字串，後面接供應商鍵名。
pub const KEY_PLACEHOLDER: &str = "rosetta-keychain:";

const ALLOWED_HOSTS: &[&str] = &["api.anthropic.com", "api.deepseek.com", "api.openai.com", "openrouter.ai"];

/// 和 packages/llm 的 bench 說明共用同一組鑰匙圈項目：服務 `rosetta-<供應商>`、帳號是 macOS 使用者名稱。
/// 用 `security add-generic-password -a "$USER" -s rosetta-anthropic -w` 存過的金鑰，殼直接讀得到。
pub fn keychain_service(provider: &str) -> String {
    format!("rosetta-{provider}")
}


/// 金鑰都在 Vault（見 vault.rs）：每次啟動只解鎖一次鑰匙圈
fn load_key(provider: &str) -> Result<Option<String>, SlackError> {
    crate::vault::global().llm_key(provider)
}

/// 只允許 https 的已知端點，或本機（Ollama 等本機模型）。
pub fn is_allowed_llm_url(raw: &str) -> bool {
    let Ok(u) = Url::parse(raw) else { return false };
    match (u.scheme(), u.host_str()) {
        ("https", Some(h)) => ALLOWED_HOSTS.contains(&h),
        ("http", Some("localhost" | "127.0.0.1" | "[::1]")) => true,
        _ => false,
    }
}

/// 把佔位字串換成鑰匙圈裡的金鑰。回傳 Err 代表該供應商沒有存金鑰。
pub fn resolve_header(value: &str, lookup: impl Fn(&str) -> Result<Option<String>, SlackError>) -> Result<String, SlackError> {
    let Some(start) = value.find(KEY_PLACEHOLDER) else { return Ok(value.to_string()) };
    let provider = &value[start + KEY_PLACEHOLDER.len()..];
    let key = lookup(provider)?.ok_or_else(|| SlackError::Internal(format!("還沒設定 {provider} 的 API 金鑰")))?;
    Ok(format!("{}{}", &value[..start], key))
}

#[derive(Deserialize)]
pub struct LlmHttpRequest {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

#[derive(Serialize)]
pub struct LlmHttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| reqwest::Client::builder().timeout(std::time::Duration::from_secs(300)).build().expect("reqwest client"))
}

/// 開發版在終端機印一行請求摘要，方便看翻譯速度與失敗。只有端點、模型、effort，不含訊息內容與金鑰。
fn debug_log(line: &str) {
    if cfg!(debug_assertions) {
        eprintln!("[llm] {line}");
    }
}

pub fn request_summary(url: &str, body: Option<&str>) -> String {
    let target = url::Url::parse(url).map(|u| format!("{}{}", u.host_str().unwrap_or("?"), u.path())).unwrap_or_else(|_| "?".into());
    let json: Option<serde_json::Value> = body.and_then(|b| serde_json::from_str(b).ok());
    let field = |k: &str| json.as_ref().and_then(|j| j.get(k)).and_then(|v| v.as_str()).map(str::to_string);
    let model = field("model").unwrap_or_else(|| "?".into());
    let effort = field("reasoning_effort")
        .or_else(|| json.as_ref().and_then(|j| j.pointer("/output_config/effort")).and_then(|v| v.as_str()).map(str::to_string));
    match effort {
        Some(e) => format!("{target} {model}@{e}"),
        None => format!("{target} {model}"),
    }
}

#[tauri::command]
pub async fn llm_http(req: LlmHttpRequest) -> Result<LlmHttpResponse, ShellError> {
    if !is_allowed_llm_url(&req.url) {
        return Err(SlackError::Internal("不允許的 LLM 端點".into()).into());
    }
    let method = reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|_| SlackError::Internal("HTTP 方法不正確".into()))?;
    let mut builder = client().request(method, &req.url);
    for (name, value) in &req.headers {
        let lower = name.to_ascii_lowercase();
        // 這些由 reqwest 自己處理
        if matches!(lower.as_str(), "host" | "content-length" | "connection") {
            continue;
        }
        builder = builder.header(name, resolve_header(value, load_key)?);
    }
    let started = std::time::Instant::now();
    let summary = request_summary(&req.url, req.body.as_deref());
    if let Some(body) = req.body {
        builder = builder.body(body);
    }
    let resp = match builder.send().await {
        Ok(r) => r,
        Err(e) => {
            debug_log(&format!("{summary} -> 連線失敗 {}ms", started.elapsed().as_millis()));
            return Err(SlackError::Network(e.without_url().to_string()).into());
        }
    };
    let status = resp.status().as_u16();
    let headers = resp
        .headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.as_str().to_string(), v.to_string())))
        .collect();
    // 計時要等內容讀完：DeepSeek 非串流請求會先回標頭，處理中只送空行
    let body = resp.text().await.map_err(|e| SlackError::Network(e.without_url().to_string()))?;
    debug_log(&format!("{summary} -> {status} {}ms", started.elapsed().as_millis()));
    Ok(LlmHttpResponse { status, headers, body })
}

/// 回傳每個供應商是否已存金鑰（不回傳金鑰本身）。
#[tauri::command]
pub fn llm_key_status(providers: Vec<String>) -> Result<HashMap<String, bool>, ShellError> {
    let mut out = HashMap::new();
    for p in providers {
        let has = load_key(&p)?.is_some_and(|k| !k.is_empty());
        out.insert(p, has);
    }
    Ok(out)
}

/// 存金鑰；傳空字串或 null 代表刪除。
#[tauri::command]
pub fn llm_key_set(provider: String, key: Option<String>) -> Result<(), ShellError> {
    let key = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
    crate::vault::global().set_llm_key(&provider, key)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_summary_has_model_and_effort_but_no_content() {
        let body = r#"{"model":"deepseek-flash","reasoning_effort":"high","messages":[{"role":"user","content":"secret draft"}]}"#;
        let s = request_summary("https://api.deepseek.com/chat/completions", Some(body));
        assert_eq!(s, "api.deepseek.com/chat/completions deepseek-flash@high");
        assert!(!s.contains("secret"));
        let a = request_summary("https://api.anthropic.com/v1/messages", Some(r#"{"model":"claude-sonnet-5-5","output_config":{"effort":"low"}}"#));
        assert_eq!(a, "api.anthropic.com/v1/messages claude-sonnet-5-5@low");
        assert_eq!(request_summary("https://api.deepseek.com/models", None), "api.deepseek.com/models ?");
    }

    #[test]
    fn allows_only_known_llm_endpoints() {
        assert!(is_allowed_llm_url("https://api.anthropic.com/v1/messages"));
        assert!(is_allowed_llm_url("https://api.deepseek.com/chat/completions"));
        assert!(is_allowed_llm_url("http://localhost:11434/v1/chat/completions"));
        assert!(!is_allowed_llm_url("http://api.anthropic.com/v1/messages"));
        assert!(!is_allowed_llm_url("https://api.anthropic.com.evil.test/v1"));
        assert!(!is_allowed_llm_url("https://slack.com/api/chat.postMessage"));
        assert!(!is_allowed_llm_url("not a url"));
    }

    #[test]
    fn swaps_placeholder_for_stored_key() {
        let lookup = |p: &str| Ok(if p == "deepseek" { Some("sk-real".to_string()) } else { None });
        assert_eq!(resolve_header("Bearer rosetta-keychain:deepseek", lookup).unwrap(), "Bearer sk-real");
        assert_eq!(resolve_header("application/json", lookup).unwrap(), "application/json");
        assert!(resolve_header("rosetta-keychain:anthropic", lookup).is_err());
    }
}

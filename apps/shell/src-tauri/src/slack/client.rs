//! 在 transport 之上處理 `ok:false`、限流退避與 5xx 重試。
use super::transport::{BytesResponse, HttpTransport, Params};
use crate::error::SlackError;
use serde_json::Value;
use std::{sync::Arc, time::Duration};

const MAX_RETRIES: usize = 4;
const MAX_WAIT_SECS: u64 = 30;

#[derive(Clone)]
pub struct SlackClient {
    transport: Arc<dyn HttpTransport>,
}

pub fn params(pairs: &[(&str, &str)]) -> Params {
    pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
}

fn backoff(attempt: usize) -> u64 {
    (1u64 << attempt.min(5)).min(MAX_WAIT_SECS)
}

pub fn map_error_code(code: &str) -> SlackError {
    match code {
        "invalid_auth" | "not_authed" | "token_revoked" | "token_expired" | "account_inactive" => {
            SlackError::AuthInvalid
        }
        other => SlackError::Api(other.to_string()),
    }
}

impl SlackClient {
    pub fn new(transport: Arc<dyn HttpTransport>) -> Self {
        SlackClient { transport }
    }

    pub async fn call(&self, method: &str, params: Params) -> Result<Value, SlackError> {
        let mut attempt = 0;
        loop {
            let resp = self.transport.post_form(method, &params).await?;
            let wait = resp.retry_after_secs.map(|s| s.clamp(1, MAX_WAIT_SECS)).unwrap_or_else(|| backoff(attempt));
            let mut limited = resp.status == 429;
            let mut server_err = resp.status >= 500;
            let mut result: Option<Result<Value, SlackError>> = None;
            if !limited && !server_err {
                match serde_json::from_str::<Value>(&resp.body) {
                    Ok(v) => {
                        if v.get("ok").and_then(Value::as_bool) == Some(true) {
                            result = Some(Ok(v));
                        } else {
                            let code = v.get("error").and_then(Value::as_str).unwrap_or("unknown_error");
                            if code == "ratelimited" {
                                limited = true;
                            } else {
                                result = Some(Err(map_error_code(code)));
                            }
                        }
                    }
                    Err(_) => {
                        if resp.status >= 400 {
                            result = Some(Err(SlackError::Api(format!("http_{}", resp.status))));
                        } else {
                            result = Some(Err(SlackError::Api("invalid_response".into())));
                        }
                    }
                }
            }
            if let Some(r) = result {
                return r;
            }
            if attempt >= MAX_RETRIES {
                server_err = server_err && !limited;
                return Err(if server_err {
                    SlackError::Api(format!("http_{}", resp.status))
                } else {
                    SlackError::RateLimited
                });
            }
            tokio::time::sleep(Duration::from_secs(wait)).await;
            attempt += 1;
        }
    }

    pub async fn get_bytes(&self, url: &str) -> Result<BytesResponse, SlackError> {
        self.transport.get_bytes(url).await
    }

    pub async fn post_bytes(&self, url: &str, bytes: Vec<u8>) -> Result<u16, SlackError> {
        self.transport.post_bytes(url, bytes).await
    }
}

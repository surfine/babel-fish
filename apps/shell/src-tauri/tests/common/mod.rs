#![allow(dead_code)]
use async_trait::async_trait;
use rosetta_shell_lib::error::SlackError;
use rosetta_shell_lib::slack::api::WebSessionSlack;
use rosetta_shell_lib::slack::client::SlackClient;
use rosetta_shell_lib::slack::transport::{BytesResponse, HttpResponse, HttpTransport, Params};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

pub const SELF_ID: &str = "U023BECGF";

#[derive(Debug, Clone)]
pub struct Recorded {
    pub method: String,
    pub params: Params,
}

impl Recorded {
    pub fn param(&self, k: &str) -> Option<&str> {
        self.params.iter().find(|(key, _)| key == k).map(|(_, v)| v.as_str())
    }
}

/// 照順序回放預錄回應，並記錄每個請求。
#[derive(Default)]
pub struct RecordingTransport {
    responses: Mutex<VecDeque<HttpResponse>>,
    pub requests: Mutex<Vec<Recorded>>,
    pub uploads: Mutex<Vec<(String, usize)>>,
}

pub fn ok(body: &str) -> HttpResponse {
    HttpResponse { status: 200, retry_after_secs: None, body: body.to_string() }
}

pub fn status(code: u16, retry_after: Option<u64>, body: &str) -> HttpResponse {
    HttpResponse { status: code, retry_after_secs: retry_after, body: body.to_string() }
}

impl RecordingTransport {
    pub fn new(responses: Vec<HttpResponse>) -> Arc<Self> {
        Arc::new(RecordingTransport { responses: Mutex::new(responses.into()), ..Default::default() })
    }
    pub fn methods(&self) -> Vec<String> {
        self.requests.lock().unwrap().iter().map(|r| r.method.clone()).collect()
    }
    pub fn request(&self, i: usize) -> Recorded {
        self.requests.lock().unwrap()[i].clone()
    }
}

#[async_trait]
impl HttpTransport for RecordingTransport {
    async fn post_form(&self, method: &str, params: &Params) -> Result<HttpResponse, SlackError> {
        self.requests.lock().unwrap().push(Recorded { method: method.to_string(), params: params.clone() });
        self.responses.lock().unwrap().pop_front().ok_or_else(|| SlackError::Internal(format!("no recorded response for {method}")))
    }
    async fn get_bytes(&self, _url: &str) -> Result<BytesResponse, SlackError> {
        Ok(BytesResponse { status: 200, content_type: Some("image/png".into()), bytes: vec![1, 2, 3] })
    }
    async fn post_bytes(&self, url: &str, bytes: Vec<u8>) -> Result<u16, SlackError> {
        self.uploads.lock().unwrap().push((url.to_string(), bytes.len()));
        Ok(200)
    }
}

pub fn client(t: &Arc<RecordingTransport>) -> SlackClient {
    SlackClient::new(t.clone())
}

pub fn api(t: &Arc<RecordingTransport>) -> WebSessionSlack {
    WebSessionSlack::new(client(t), SELF_ID.into(), Some("xoxd-test".into()))
}

macro_rules! fixture {
    ($name:literal) => {
        include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/", $name))
    };
}
pub(crate) use fixture;

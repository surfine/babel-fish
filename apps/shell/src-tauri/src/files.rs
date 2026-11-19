//! `slackfile://` 檔案代理的網址白名單與回應建構。
use percent_encoding::percent_decode_str;

const ALLOWED_DOMAINS: [&str; 3] = ["slack.com", "slack-edge.com", "slack-files.com"];

pub fn is_allowed_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    ALLOWED_DOMAINS.iter().any(|d| host == *d || host.ends_with(&format!(".{d}")))
}

/// 只允許 https、無帳密、預設連接埠、主機為白名單網域（或其子網域）的網址。
pub fn is_allowed_slackfile_url(raw: &str) -> bool {
    let Ok(u) = url::Url::parse(raw) else { return false };
    u.scheme() == "https"
        && u.username().is_empty()
        && u.password().is_none()
        && u.port().is_none()
        && u.host_str().is_some_and(is_allowed_host)
}

/// 從 `slackfile://localhost/<encodeURIComponent(原網址)>` 的 path 取回原網址。
pub fn target_from_path(path: &str) -> Option<String> {
    let rest = path.strip_prefix('/')?;
    if rest.is_empty() {
        return None;
    }
    percent_decode_str(rest).decode_utf8().ok().map(|c| c.into_owned())
}

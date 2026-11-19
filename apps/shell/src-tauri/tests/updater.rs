use rosetta_shell_lib::updater_configured;
use serde_json::{json, Value};
use std::collections::HashMap;

fn plugins(v: Value) -> HashMap<String, Value> {
    serde_json::from_value(v).unwrap()
}

#[test]
fn updater_needs_pubkey_and_endpoint() {
    assert!(!updater_configured(&plugins(json!({}))));
    assert!(!updater_configured(&plugins(json!({ "updater": { "pubkey": "", "endpoints": ["https://x/latest.json"] } }))));
    assert!(!updater_configured(&plugins(json!({ "updater": { "pubkey": "abc", "endpoints": [] } }))));
    assert!(updater_configured(&plugins(json!({ "updater": { "pubkey": "abc", "endpoints": ["https://x/latest.json"] } }))));
}

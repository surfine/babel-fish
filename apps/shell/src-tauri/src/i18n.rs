//! 給人看的字串（錯誤訊息、視窗標題、鑰匙圈提示）跟著介面語言。
//! 原文（鍵）是台灣正體，寫成 tr("…")；前端啟動時呼叫 set_ui_locale，把這些鍵翻好的版本傳進來。
//! 還沒傳進來（或少了某個鍵）就顯示原文。前端的抽取腳本（apps/shell/scripts/i18n.mjs）會找出這裡的 tr()。
use std::collections::HashMap;
use std::sync::RwLock;

static STRINGS: RwLock<Option<HashMap<String, String>>> = RwLock::new(None);

pub fn set_strings(strings: HashMap<String, String>) {
    if let Ok(mut s) = STRINGS.write() {
        *s = Some(strings);
    }
}

/// 翻譯一個鍵
pub fn tr(key: &str) -> String {
    STRINGS
        .read()
        .ok()
        .and_then(|s| s.as_ref().and_then(|m| m.get(key).filter(|v| !v.is_empty()).cloned()))
        .unwrap_or_else(|| key.to_string())
}

/// 翻譯後把 {0}、{1}… 換成參數
pub fn trf(key: &str, args: &[&str]) -> String {
    let mut out = tr(key);
    for (i, a) in args.iter().enumerate() {
        out = out.replace(&format!("{{{i}}}"), a);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn falls_back_to_the_key_and_fills_arguments() {
        // 只用測試專用的鍵：其他測試同時在跑，不能動到它們會用到的字串
        assert_eq!(trf("測試用的鍵 {0}", &["deepseek"]), "測試用的鍵 deepseek");
        set_strings(HashMap::from([("測試用的鍵 {0}".to_string(), "test key {0}".to_string())]));
        assert_eq!(trf("測試用的鍵 {0}", &["deepseek"]), "test key deepseek");
        assert_eq!(tr("沒有這個鍵"), "沒有這個鍵");
    }
}

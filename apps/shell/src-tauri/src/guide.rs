//! 「複製並打開 Slack」之後的貼上引導卡：一個小的浮動視窗，停在官方 Slack 視窗旁邊。
//! 位置用 CGWindowList 讀 Slack 視窗的外框（只讀擁有者名稱與外框，不需要螢幕錄製或輔助使用權限）。
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "guide";
pub const CARD_W: f64 = 340.0;
/// 預設高度；引導卡載入後用 guide_resize 回報實際內容高度
pub const CARD_H: f64 = 300.0;
const GAP: f64 = 12.0;
/// Slack 視窗底部的輸入框大約這麼高；卡片放在它上面，不擋住輸入框
const COMPOSER_H: f64 = 150.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// 卡片左上角的位置（全域座標，左上為原點）。
/// 優先放在 Slack 視窗右側外面、底部對齊輸入框；右邊放不下就放左側外面；兩邊都不夠就放進視窗內右下、輸入框上方。
/// 找不到 Slack 視窗時放在螢幕右下角。
pub fn place_card(slack: Option<Rect>, screen: Rect, card_h: f64) -> (f64, f64) {
    let card_h = card_h.clamp(80.0, screen.h);
    let clamp = |x: f64, y: f64| {
        (
            x.clamp(screen.x, screen.x + screen.w - CARD_W),
            y.clamp(screen.y, screen.y + screen.h - card_h),
        )
    };
    let Some(s) = slack else {
        return clamp(screen.x + screen.w - CARD_W - 24.0, screen.y + screen.h - card_h - 24.0);
    };
    let bottom_y = s.y + s.h - card_h;
    if s.x + s.w + GAP + CARD_W <= screen.x + screen.w {
        return clamp(s.x + s.w + GAP, bottom_y);
    }
    if s.x - GAP - CARD_W >= screen.x {
        return clamp(s.x - GAP - CARD_W, bottom_y);
    }
    clamp(s.x + s.w - CARD_W - 20.0, s.y + s.h - COMPOSER_H - card_h)
}

/// 從 CGWindowList 找官方 Slack 最大的一般視窗（layer 0）。
#[cfg(target_os = "macos")]
pub fn slack_window() -> Option<Rect> {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use core_graphics::window::{copy_window_info, kCGNullWindowID, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly};

    let list = copy_window_info(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID)?;
    let mut best: Option<Rect> = None;
    for item in list.iter() {
        let dict: CFDictionary<CFString, CFType> = unsafe { CFDictionary::wrap_under_get_rule(*item as _) };
        let owner = dict.find(CFString::from_static_string("kCGWindowOwnerName")).and_then(|v| v.downcast::<CFString>()).map(|s| s.to_string());
        if owner.as_deref() != Some("Slack") {
            continue;
        }
        let layer = dict.find(CFString::from_static_string("kCGWindowLayer")).and_then(|v| v.downcast::<CFNumber>()).and_then(|n| n.to_i64());
        if layer != Some(0) {
            continue;
        }
        let Some(bounds) = dict.find(CFString::from_static_string("kCGWindowBounds")).and_then(|v| v.downcast::<CFDictionary>()) else { continue };
        let bounds: CFDictionary<CFString, CFType> = unsafe { CFDictionary::wrap_under_get_rule(bounds.as_concrete_TypeRef()) };
        let num = |k: &'static str| bounds.find(CFString::from_static_string(k)).and_then(|v| v.downcast::<CFNumber>()).and_then(|n| n.to_f64());
        let (Some(x), Some(y), Some(w), Some(h)) = (num("X"), num("Y"), num("Width"), num("Height")) else { continue };
        if w < 300.0 || h < 200.0 {
            continue;
        }
        if best.is_none_or(|b| b.w * b.h < w * h) {
            best = Some(Rect { x, y, w, h });
        }
    }
    best
}

#[cfg(not(target_os = "macos"))]
pub fn slack_window() -> Option<Rect> {
    None
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GuideData {
    /// 要貼上的英文（多則時以空行相接）
    pub text: String,
    /// 頻道顯示名稱，例如 #newsroom
    pub where_label: String,
    /// channel、private、im、mpim：引導卡照 Slack 的寫法顯示頻道名稱
    #[serde(default)]
    pub where_kind: String,
    /// 這次是討論串回覆（Slack 沒有討論串的深層連結，要提醒使用者自己打開）
    pub is_thread: bool,
    /// 用過幾次之後只顯示精簡版
    pub compact: bool,
    /// 再複製一次後要重新打開的 slack:// 網址
    pub slack_url: String,
}

pub struct GuideState {
    pub data: Mutex<GuideData>,
    pub height: Mutex<f64>,
}

impl Default for GuideState {
    fn default() -> Self {
        Self { data: Mutex::new(GuideData::default()), height: Mutex::new(CARD_H) }
    }
}

fn screen_of(app: &AppHandle, near: Option<Rect>) -> Rect {
    let monitors = app.available_monitors().unwrap_or_default();
    let pick = near.and_then(|s| {
        monitors.iter().find(|m| {
            let f = m.scale_factor();
            let p = m.position().to_logical::<f64>(f);
            let z = m.size().to_logical::<f64>(f);
            s.x + s.w / 2.0 >= p.x && s.x + s.w / 2.0 < p.x + z.width && s.y + s.h / 2.0 >= p.y && s.y + s.h / 2.0 < p.y + z.height
        })
    });
    let m = pick.or_else(|| monitors.first());
    match m {
        Some(m) => {
            let f = m.scale_factor();
            let p = m.position().to_logical::<f64>(f);
            let z = m.size().to_logical::<f64>(f);
            Rect { x: p.x, y: p.y, w: z.width, h: z.height }
        }
        None => Rect { x: 0.0, y: 0.0, w: 1440.0, h: 900.0 },
    }
}

fn current_position(app: &AppHandle) -> (f64, f64) {
    let slack = slack_window();
    let h = *app.state::<GuideState>().height.lock().unwrap();
    place_card(slack, screen_of(app, slack), h)
}

#[tauri::command]
pub fn guide_open(app: AppHandle, data: GuideData) -> Result<(), String> {
    *app.state::<GuideState>().data.lock().unwrap() = data.clone();
    let (x, y) = current_position(&app);
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.set_position(LogicalPosition::new(x, y));
        let _ = w.show();
        return w.emit_to(LABEL, "guide://data", data).map_err(|e| e.to_string());
    }
    let w = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("index.html".into()))
        .title("貼上提示")
        .inner_size(CARD_W, *app.state::<GuideState>().height.lock().unwrap())
        .position(x, y)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .focused(false)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;
    // 跟著 Slack 視窗移動；視窗關掉就停
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last = (x, y);
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            let Some(win) = handle.get_webview_window(LABEL) else { break };
            let pos = current_position(&handle);
            if (pos.0 - last.0).abs() > 0.5 || (pos.1 - last.1).abs() > 0.5 {
                let _ = win.set_position(LogicalPosition::new(pos.0, pos.1));
                last = pos;
            }
        }
    });
    drop(w);
    Ok(())
}

/// 引導卡載入時取目前的資料（避免錯過 guide_open 當下送出的事件）
#[tauri::command]
pub fn guide_data(app: AppHandle) -> GuideData {
    app.state::<GuideState>().data.lock().unwrap().clone()
}

/// 主視窗看到使用者在官方 Slack 送出了剛才複製的英文
#[tauri::command]
pub fn guide_sent(app: AppHandle) -> Result<(), String> {
    match app.get_webview_window(LABEL) {
        Some(w) => w.emit_to(LABEL, "guide://sent", ()).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// 引導卡回報內容高度：調整視窗大小並重新定位（底部仍對齊 Slack 的輸入框）
#[tauri::command]
pub fn guide_resize(app: AppHandle, height: f64) -> Result<(), String> {
    let h = height.clamp(80.0, 600.0);
    *app.state::<GuideState>().height.lock().unwrap() = h;
    if let Some(w) = app.get_webview_window(LABEL) {
        w.set_size(tauri::LogicalSize::new(CARD_W, h)).map_err(|e| e.to_string())?;
        let (x, y) = current_position(&app);
        w.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn guide_close(app: AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
}

/// 再複製一次並切回 Slack。用 pbcopy 寫剪貼簿，不必讓引導卡取得焦點。
#[tauri::command]
pub fn guide_copy_again(app: AppHandle) -> Result<(), String> {
    use std::io::Write;
    let data = app.state::<GuideState>().data.lock().unwrap().clone();
    let mut child = std::process::Command::new("/usr/bin/pbcopy").stdin(std::process::Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    child.stdin.take().ok_or("pbcopy")?.write_all(data.text.as_bytes()).map_err(|e| e.to_string())?;
    child.wait().map_err(|e| e.to_string())?;
    if data.slack_url.starts_with("slack://") {
        std::process::Command::new("/usr/bin/open").arg(&data.slack_url).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

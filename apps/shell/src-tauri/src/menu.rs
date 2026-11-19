//! 選單列：照 macOS 的標準選單排，文字跟著介面語言（台灣、香港、大陆、马新、English）。
//! 前端啟動時呼叫 set_ui_locale，換語言時重建。
use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

pub struct Labels {
    pub about: &'static str,
    pub settings: &'static str,
    pub services: &'static str,
    pub hide: &'static str,
    pub hide_others: &'static str,
    pub show_all: &'static str,
    pub quit: &'static str,
    pub edit: &'static str,
    pub undo: &'static str,
    pub redo: &'static str,
    pub cut: &'static str,
    pub copy: &'static str,
    pub paste: &'static str,
    pub select_all: &'static str,
    pub view: &'static str,
    pub fullscreen: &'static str,
    pub window: &'static str,
    pub minimize: &'static str,
    pub zoom: &'static str,
    pub close: &'static str,
}

/// 用語照各地區 macOS 自己的選單（例如台灣「拷貝」、大陆「拷贝」「撤销」「退出」）
pub fn labels(locale: &str) -> Labels {
    match locale {
        "zh-CN" | "zh-SG" => Labels {
            about: "关于 Babel Fish",
            settings: "设置…",
            services: "服务",
            hide: "隐藏 Babel Fish",
            hide_others: "隐藏其他",
            show_all: "全部显示",
            quit: "退出 Babel Fish",
            edit: "编辑",
            undo: "撤销",
            redo: "重做",
            cut: "剪切",
            copy: "拷贝",
            paste: "粘贴",
            select_all: "全选",
            view: "显示",
            fullscreen: "进入全屏幕",
            window: "窗口",
            minimize: "最小化",
            zoom: "缩放",
            close: "关闭窗口",
        },
        "en" => Labels {
            about: "About Babel Fish",
            settings: "Settings…",
            services: "Services",
            hide: "Hide Babel Fish",
            hide_others: "Hide Others",
            show_all: "Show All",
            quit: "Quit Babel Fish",
            edit: "Edit",
            undo: "Undo",
            redo: "Redo",
            cut: "Cut",
            copy: "Copy",
            paste: "Paste",
            select_all: "Select All",
            view: "View",
            fullscreen: "Enter Full Screen",
            window: "Window",
            minimize: "Minimize",
            zoom: "Zoom",
            close: "Close Window",
        },
        // zh-TW 與 zh-HK
        _ => Labels {
            about: "關於 Babel Fish",
            settings: "設定…",
            services: "服務",
            hide: "隱藏 Babel Fish",
            hide_others: "隱藏其他",
            show_all: "顯示全部",
            quit: "結束 Babel Fish",
            edit: "編輯",
            undo: "還原",
            redo: "重做",
            cut: "剪下",
            copy: "拷貝",
            paste: "貼上",
            select_all: "全選",
            view: if locale == "zh-HK" { "顯示" } else { "顯示方式" },
            fullscreen: "進入全螢幕",
            window: "視窗",
            minimize: "最小化",
            zoom: "縮放",
            close: "關閉視窗",
        },
    }
}

pub fn build<R: Runtime>(app: &AppHandle<R>, locale: &str) -> tauri::Result<Menu<R>> {
    let l = labels(locale);
    let sep = || PredefinedMenuItem::separator(app);
    let settings = MenuItemBuilder::with_id("settings", l.settings).accelerator("CmdOrCtrl+,").build(app)?;
    let app_menu = Submenu::with_items(
        app,
        "Babel Fish",
        true,
        &[
            &PredefinedMenuItem::about(app, Some(l.about), None)?,
            &sep()?,
            &settings,
            &sep()?,
            &PredefinedMenuItem::services(app, Some(l.services))?,
            &sep()?,
            &PredefinedMenuItem::hide(app, Some(l.hide))?,
            &PredefinedMenuItem::hide_others(app, Some(l.hide_others))?,
            &PredefinedMenuItem::show_all(app, Some(l.show_all))?,
            &sep()?,
            &PredefinedMenuItem::quit(app, Some(l.quit))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        l.edit,
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(l.undo))?,
            &PredefinedMenuItem::redo(app, Some(l.redo))?,
            &sep()?,
            &PredefinedMenuItem::cut(app, Some(l.cut))?,
            &PredefinedMenuItem::copy(app, Some(l.copy))?,
            &PredefinedMenuItem::paste(app, Some(l.paste))?,
            &PredefinedMenuItem::select_all(app, Some(l.select_all))?,
        ],
    )?;
    let view = Submenu::with_items(app, l.view, true, &[&PredefinedMenuItem::fullscreen(app, Some(l.fullscreen))?])?;
    let window = Submenu::with_items(
        app,
        l.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(l.minimize))?,
            &PredefinedMenuItem::maximize(app, Some(l.zoom))?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, Some(l.close))?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &view, &window])
}

/// 前端告訴 Rust 目前的介面語言，選單列跟著換
#[tauri::command]
pub fn set_ui_locale(app: AppHandle, locale: String) -> Result<(), String> {
    let menu = build(&app, &locale).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::labels;

    #[test]
    fn labels_follow_each_region_macos_wording() {
        assert_eq!(labels("zh-TW").copy, "拷貝");
        assert_eq!(labels("zh-TW").quit, "結束 Babel Fish");
        assert_eq!(labels("zh-HK").view, "顯示");
        assert_eq!(labels("zh-CN").undo, "撤销");
        assert_eq!(labels("zh-SG").quit, "退出 Babel Fish");
        assert_eq!(labels("en").settings, "Settings…");
        assert_eq!(labels("unknown").settings, "設定…");
    }
}

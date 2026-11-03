//! The Browser tab: one native child webview, embedded inside the main window at the bounds the
//! page's own container reports. Strictly manual — the seller clicks, types and reads it exactly
//! like any browser tab. There is no `click()`/`fill()`/`navigate()`-style automation API here:
//! the only commands are the same handful of actions an address bar and three toolbar buttons
//! give you (go to an address, back, forward, reload, close), each wired to the seller's own
//! click or keypress, never callable by anything else and never exposed over MCP or any other
//! channel to an outside program. No profile manager, no saved passwords, no cookie access from
//! the app side — whatever the OS webview's own default storage keeps is between the seller and
//! the site, the same as any browser.
//!
//! `browser_back`/`browser_forward` are the one place this evaluates script in the page, and it
//! is two fixed literals (`history.back()`/`history.forward()`) wired to two fixed buttons — the
//! same thing clicking a real browser's back button does under the hood — never an arbitrary
//! string from the frontend or from anywhere else.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl};

const LABEL: &str = "browser-tab";
const MAIN_WINDOW: &str = "main";

/// A real iPhone Safari UA, so sites that branch on it (not just on viewport width) still give
/// their mobile layout — this is what TikTok's own login/profile pages need to avoid the desktop
/// sidebar overflowing a narrow panel. The seller can turn it off per-site from the address bar
/// if a desktop layout is what they want instead.
const MOBILE_UA: &str =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

#[derive(Default)]
pub struct BrowserTabState(pub Mutex<Option<Webview>>);

#[derive(Serialize, Clone)]
pub struct BrowserNavigated {
    pub url: String,
}

fn normalize(input: &str) -> Result<url::Url, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("EMPTY_URL".into());
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let u = url::Url::parse(&with_scheme).map_err(|_| "BAD_URL".to_string())?;
    if u.scheme() != "https" && u.scheme() != "http" {
        return Err("BAD_SCHEME".into());
    }
    Ok(u)
}

/// Opens (or reuses) the embedded tab at the given logical bounds and navigates it to `url`.
/// `mobile` picks the UA; the caller passes the container `<div>`'s own rect so the webview
/// always sits exactly under it, never drawn outside the content area.
#[tauri::command]
pub fn browser_open(
    app: AppHandle,
    state: tauri::State<'_, BrowserTabState>,
    url: String,
    mobile: bool,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<String, String> {
    let target = normalize(&url)?;
    let mut guard = state.0.lock().map_err(|_| "LOCK".to_string())?;

    if let Some(existing) = guard.as_ref() {
        existing
            .navigate(target.clone())
            .map_err(|e| e.to_string())?;
        existing
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        existing
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        existing.show().map_err(|e| e.to_string())?;
        return Ok(target.to_string());
    }

    let window = app
        .get_window(MAIN_WINDOW)
        .ok_or_else(|| "NO_MAIN_WINDOW".to_string())?;

    let app_for_events = app.clone();
    let mut builder =
        tauri::webview::WebviewBuilder::new(LABEL, WebviewUrl::External(target.clone()))
            .on_navigation(move |u| {
                let _ = app_for_events.emit(
                    "browser-tab://navigated",
                    BrowserNavigated { url: u.to_string() },
                );
                true
            });
    if mobile {
        builder = builder.user_agent(MOBILE_UA);
    }

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;

    *guard = Some(webview);
    Ok(target.to_string())
}

#[tauri::command]
pub fn browser_navigate(
    state: tauri::State<'_, BrowserTabState>,
    url: String,
) -> Result<String, String> {
    let target = normalize(&url)?;
    let guard = state.0.lock().map_err(|_| "LOCK".to_string())?;
    let wv = guard.as_ref().ok_or_else(|| "NOT_OPEN".to_string())?;
    wv.navigate(target.clone()).map_err(|e| e.to_string())?;
    Ok(target.to_string())
}

#[tauri::command]
pub fn browser_set_bounds(
    state: tauri::State<'_, BrowserTabState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "LOCK".to_string())?;
    let wv = guard.as_ref().ok_or_else(|| "NOT_OPEN".to_string())?;
    wv.set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    wv.set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_reload(state: tauri::State<'_, BrowserTabState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "LOCK".to_string())?;
    let wv = guard.as_ref().ok_or_else(|| "NOT_OPEN".to_string())?;
    wv.reload().map_err(|e| e.to_string())
}

/// Same as clicking a real browser's back button — a fixed, literal script, never a string the
/// frontend (or anything else) supplies.
#[tauri::command]
pub fn browser_back(state: tauri::State<'_, BrowserTabState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "LOCK".to_string())?;
    let wv = guard.as_ref().ok_or_else(|| "NOT_OPEN".to_string())?;
    wv.eval("history.back()").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_forward(state: tauri::State<'_, BrowserTabState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "LOCK".to_string())?;
    let wv = guard.as_ref().ok_or_else(|| "NOT_OPEN".to_string())?;
    wv.eval("history.forward()").map_err(|e| e.to_string())
}

/// Hides the tab (switching away in the app's own nav) without losing its page or history.
#[tauri::command]
pub fn browser_hide(state: tauri::State<'_, BrowserTabState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "LOCK".to_string())?;
    if let Some(wv) = guard.as_ref() {
        wv.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn browser_show(
    state: tauri::State<'_, BrowserTabState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "LOCK".to_string())?;
    if let Some(wv) = guard.as_ref() {
        wv.set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        wv.set_size(LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        wv.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Closes the tab outright (the seller closed the Browser tab, or the app is quitting that view
/// for good) — drops the native webview. The OS webview's own storage is unaffected, same as
/// closing any browser tab.
#[tauri::command]
pub fn browser_close(state: tauri::State<'_, BrowserTabState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "LOCK".to_string())?;
    if let Some(wv) = guard.take() {
        wv.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_bare_host_to_https() {
        assert_eq!(
            normalize("tiktok.com").unwrap().as_str(),
            "https://tiktok.com/"
        );
        assert_eq!(
            normalize("https://x.com/a").unwrap().as_str(),
            "https://x.com/a"
        );
    }

    #[test]
    fn rejects_empty_and_non_web_schemes() {
        assert!(normalize("").is_err());
        assert!(normalize("   ").is_err());
        assert!(normalize("javascript:alert(1)").is_err());
        assert!(normalize("file:///etc/passwd").is_err());
    }
}

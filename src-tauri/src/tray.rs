//! Keeps the app reachable while its window is closed. With phone sharing on, closing the window
//! only hides it, so the phone link keeps working (scans, orders, printing through this
//! computer); the tray (Windows) / menu-bar (macOS) icon and the Dock icon bring it back, and its
//! menu quits for real. With sharing off, closing the window quits as usual.

use crate::commands::UiLabels;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Window, WindowEvent, Wry};

const MAIN: &str = "main";

#[derive(Default)]
pub struct TrayItems(Mutex<Option<(MenuItem<Wry>, MenuItem<Wry>)>>);

/// Whether the "still running" notice was shown this run (once is enough).
#[derive(Default)]
pub struct HiddenNoticeShown(Mutex<bool>);

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "LIVE STUDIO", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("LIVE STUDIO")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = e
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    *app.state::<TrayItems>().0.lock().unwrap() = Some((open, quit));
    Ok(())
}

/// The frontend sends the words in the seller's language (`ui_set_labels`).
pub fn relabel(app: &AppHandle, l: &crate::commands::Labels) {
    if let Some((open, quit)) = app.state::<TrayItems>().0.lock().unwrap().as_ref() {
        if !l.open.is_empty() {
            let _ = open.set_text(&l.open);
        }
        if !l.quit.is_empty() {
            let _ = quit.set_text(&l.quit);
        }
    }
}

/// Closing the main window while a phone may be using this computer: hide instead of quit.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    if window.label() != MAIN {
        return;
    }
    let app = window.app_handle();
    if !crate::share::is_running(&app.state::<crate::share::ShareState>()) {
        return;
    }
    api.prevent_close();
    let _ = window.hide();
    let first = {
        let state = app.state::<HiddenNoticeShown>();
        let mut shown = state.0.lock().unwrap();
        !std::mem::replace(&mut *shown, true)
    };
    if first {
        let l = app.state::<UiLabels>().0.lock().unwrap().clone();
        if !l.hidden_title.is_empty() {
            use tauri_plugin_notification::NotificationExt;
            let _ = app
                .notification()
                .builder()
                .title(l.hidden_title)
                .body(l.hidden_body)
                .show();
        }
    }
}

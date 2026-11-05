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
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::webview::DownloadEvent;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl};

const LABEL: &str = "browser-tab";
const MAIN_WINDOW: &str = "main";

/// A phone browser's UA, so sites that branch on it (not just on viewport width) give their
/// mobile layout — TikTok's login/profile pages need it. An Android Chrome one, not iPhone
/// Safari: with an iPhone UA TikTok keeps sending the page to its iOS app / the App Store,
/// which on a Mac with Apple silicon opens the TikTok app or the App Store instead of the page.
/// The seller can turn phone mode off from the address bar for a desktop layout.
/// Desktop layout only: a site built for a wide screen (MyShip needs ~1200px) is scaled down to
/// the tab's width instead of hiding its right side (the login link) off screen. A fixed,
/// literal script; it only reads the page's width and sets the page zoom.
const FIT_WIDTH_JS: &str = r#"(function () {
  if (window.top !== window) return;
  function fit() {
    var d = document.documentElement;
    if (!d) return;
    d.style.zoom = "";
    var w = d.scrollWidth, v = window.innerWidth;
    if (w > v + 8) d.style.zoom = String(Math.max(0.5, v / w));
  }
  var t;
  function later() { clearTimeout(t); t = setTimeout(fit, 150); }
  window.addEventListener("load", function () { fit(); setTimeout(fit, 800); });
  window.addEventListener("resize", later);
})();"#;

const MOBILE_UA: &str =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

/// App stores and app-only links a site may push the tab to ("open in the TikTok app",
/// "get the app"). The tab stays on the web page instead; the seller is told why.
fn leaves_the_web(u: &url::Url) -> bool {
    if u.scheme() != "https"
        && u.scheme() != "http"
        && u.scheme() != "about"
        && u.scheme() != "blob"
        && u.scheme() != "data"
    {
        return true; // snssdk1233://, tiktok://, intent://, itms-apps://, market://
    }
    let host = u.host_str().unwrap_or("");
    const STORES: [&str; 4] = [
        "apps.apple.com",
        "itunes.apple.com",
        "play.google.com",
        "app.adjust.com",
    ];
    STORES
        .iter()
        .any(|h| host == *h || host.ends_with(&format!(".{h}")))
        || host.ends_with("onelink.me")
}

#[derive(Default)]
pub struct BrowserTabState(pub Mutex<Option<Webview>>);

/// The 7-ELEVEN order workbook exported last (Đơn ship → Xuất Excel), for the dev upload script.
#[derive(Default)]
pub struct LastExport(pub Mutex<Option<PathBuf>>);

const MAX_SCRIPT: usize = 20_000;
const MAX_ATTACH: u64 = 5 * 1024 * 1024;

fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (u32::from(c[0]) << 16)
            | (u32::from(*c.get(1).unwrap_or(&0)) << 8)
            | u32::from(*c.get(2).unwrap_or(&0));
        for (i, shift) in [18, 12, 6, 0].into_iter().enumerate() {
            if i <= c.len() {
                out.push(T[((n >> shift) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Only MyShip pages (myship / myship2 .7-11.com.tw) may run the seller's upload script.
fn is_myship(u: &url::Url) -> bool {
    u.scheme() == "https"
        && u.host_str()
            .is_some_and(|h| h == "7-11.com.tw" || h.ends_with(".7-11.com.tw"))
}

/// The page-side helpers the script gets as `__LS`, then the script itself. NAME/B64 are JSON
/// strings. Fixed text apart from the seller's own script, which the dev box in the app holds.
fn wrap_script(user: &str, name: &str, b64: &str) -> String {
    let name = serde_json::to_string(name).unwrap_or_else(|_| "\"\"".into());
    let b64 = serde_json::to_string(b64).unwrap_or_else(|_| "\"\"".into());
    format!(
        r#"(function () {{
  var F = {{ name: {name}, b64: {b64},
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }};
  var LS = window.__LS = {{
    file: F,
    toFile: function () {{
      var s = atob(F.b64), a = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
      return new File([a], F.name, {{ type: F.type }});
    }},
    attach: function (sel) {{
      var el = typeof sel === "string" ? document.querySelector(sel) : sel;
      if (!el || !F.b64) return false;
      var dt = new DataTransfer();
      dt.items.add(LS.toFile());
      el.files = dt.files;
      el.dispatchEvent(new Event("input", {{ bubbles: true }}));
      el.dispatchEvent(new Event("change", {{ bubbles: true }}));
      return true;
    }},
    click: function (re) {{
      var all = document.querySelectorAll("button, input[type=button], input[type=submit], a");
      for (var i = 0; i < all.length; i++) {{
        var t = (all[i].innerText || all[i].value || "").trim();
        if (re.test(t)) {{ all[i].click(); return true; }}
      }}
      return false;
    }},
    wait: function (ms) {{ return new Promise(function (r) {{ setTimeout(r, ms); }}); }},
    log: function (m) {{
      var d = document.getElementById("__ls_log");
      if (!d) {{
        d = document.createElement("div");
        d.id = "__ls_log";
        d.style.cssText = "position:fixed;z-index:2147483647;right:12px;bottom:12px;max-width:360px;" +
          "padding:10px 12px;border-radius:10px;background:#1c1c1e;color:#fff;" +
          "font:13px -apple-system,system-ui,sans-serif;white-space:pre-wrap";
        d.onclick = function () {{ d.remove(); }};
        document.body.appendChild(d);
      }}
      d.textContent = (d.textContent ? d.textContent + "\n" : "") + m;
    }}
  }};
  Promise.resolve().then(async function () {{
{user}
  }}).catch(function (e) {{ LS.log("Script error: " + (e && e.message ? e.message : e)); }});
}})();"#
    )
}

#[tauri::command]
pub fn browser_last_export(state: tauri::State<'_, LastExport>) -> Option<String> {
    let guard = state.0.lock().ok()?;
    let p = guard.as_ref()?;
    p.exists().then(|| file_label(p))
}

/// Dev box: runs the seller's upload script on the MyShip page open in the tab, with the last
/// exported workbook ready as `__LS.file` (`__LS.attach("input[type=file]")` puts it in the
/// page's file picker). Refused on any other site.
#[tauri::command]
pub fn browser_run_script(
    state: tauri::State<'_, BrowserTabState>,
    last: tauri::State<'_, LastExport>,
    script: String,
    attach: bool,
) -> Result<(), String> {
    if script.len() > MAX_SCRIPT {
        return Err("SCRIPT_TOO_LONG".into());
    }
    let guard = state.0.lock().map_err(|_| "LOCK".to_string())?;
    let wv = guard.as_ref().ok_or_else(|| "NOT_OPEN".to_string())?;
    let page = wv.url().map_err(|e| e.to_string())?;
    if !is_myship(&page) {
        return Err("NOT_MYSHIP".into());
    }
    let (name, b64) = if attach {
        let path = last
            .0
            .lock()
            .map_err(|_| "LOCK".to_string())?
            .clone()
            .filter(|p| p.exists())
            .ok_or_else(|| "NO_EXPORT".to_string())?;
        let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
        if size > MAX_ATTACH {
            return Err("NO_EXPORT".into());
        }
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        (file_label(&path), base64(&bytes))
    } else {
        (String::new(), String::new())
    };
    wv.eval(wrap_script(&script, &name, &b64))
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
pub struct BrowserNavigated {
    pub url: String,
}

/// A file the page downloaded (a waybill PDF, an exported sheet): where it went, and whether the
/// download finished. The embedded webview has no download bar of its own, so the app says it.
#[derive(Serialize, Clone)]
pub struct BrowserDownload {
    pub name: String,
    pub path: String,
    pub done: bool,
    pub ok: bool,
}

/// A free name in `dir` for `wanted`: "phieu.pdf", then "phieu (1).pdf", "phieu (2).pdf"...
fn free_path(dir: &Path, wanted: &str) -> PathBuf {
    let clean: String = wanted
        .chars()
        .map(|c| {
            if c.is_control() || "/\\:*?\"<>|".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let clean = clean.trim().trim_matches('.').to_string();
    let name = if clean.is_empty() {
        "download".to_string()
    } else {
        clean
    };
    let first = dir.join(&name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.clone(), String::new()),
    };
    (1..10_000)
        .map(|i| dir.join(format!("{stem} ({i}){ext}")))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

/// The file name a download should get: the one the webview suggests, else the url's last part.
fn download_name(suggested: &Path, url: &url::Url) -> String {
    suggested
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .map(str::to_string)
        .or_else(|| {
            url.path_segments()
                .and_then(|mut s| s.next_back().map(str::to_string))
                .filter(|n| !n.is_empty())
        })
        .unwrap_or_else(|| "download".into())
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
                if leaves_the_web(u) {
                    let _ = app_for_events.emit(
                        "browser-tab://blocked",
                        BrowserNavigated { url: u.to_string() },
                    );
                    return false;
                }
                let _ = app_for_events.emit(
                    "browser-tab://navigated",
                    BrowserNavigated { url: u.to_string() },
                );
                true
            })
            // "Open in a new tab" / window.open (MyShip's "列印寄件單", a waybill PDF): this tab has
            // no second tab, so the page loads right here, where Print and Back work as usual.
            // App/store links are refused as above; a blank popup a page writes into itself is
            // left to the webview.
            .on_new_window({
                let app = app.clone();
                move |u, _features| {
                    if leaves_the_web(&u) {
                        let _ = app.emit(
                            "browser-tab://blocked",
                            BrowserNavigated { url: u.to_string() },
                        );
                        return tauri::webview::NewWindowResponse::Deny;
                    }
                    if u.scheme() != "https" && u.scheme() != "http" {
                        return tauri::webview::NewWindowResponse::Allow;
                    }
                    let app2 = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        if let Ok(guard) = app2.state::<BrowserTabState>().0.lock() {
                            if let Some(wv) = guard.as_ref() {
                                let _ = wv.navigate(u);
                            }
                        }
                    });
                    tauri::webview::NewWindowResponse::Deny
                }
            })
            .on_download({
                let app = app.clone();
                let last = std::sync::Arc::new(Mutex::new(String::new()));
                move |_wv, event| {
                    match event {
                        DownloadEvent::Requested { url, destination } => {
                            let Ok(dir) = app.path().download_dir() else {
                                return true; // let the webview put it where it would anyway
                            };
                            let path = free_path(&dir, &download_name(destination, &url));
                            *destination = path.clone();
                            if let Ok(mut l) = last.lock() {
                                *l = path.to_string_lossy().into_owned();
                            }
                            let _ = app.emit(
                                "browser-tab://download",
                                BrowserDownload {
                                    name: file_label(&path),
                                    path: path.to_string_lossy().into_owned(),
                                    done: false,
                                    ok: true,
                                },
                            );
                        }
                        DownloadEvent::Finished { path, success, .. } => {
                            // macOS never passes the path here; use the one picked above.
                            let p = path
                                .map(|p| p.to_string_lossy().into_owned())
                                .unwrap_or_else(|| {
                                    last.lock().map(|l| l.clone()).unwrap_or_default()
                                });
                            let _ = app.emit(
                                "browser-tab://download",
                                BrowserDownload {
                                    name: file_label(Path::new(&p)),
                                    path: p,
                                    done: true,
                                    ok: success,
                                },
                            );
                        }
                        _ => {}
                    }
                    true
                }
            });
    if mobile {
        builder = builder.user_agent(MOBILE_UA);
    } else {
        builder = builder.initialization_script(FIT_WIDTH_JS);
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

/// The page zoom the seller picked with − / + (1.0 = 100%), kept between 50% and 200%.
#[tauri::command]
pub fn browser_zoom(state: tauri::State<'_, BrowserTabState>, scale: f64) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "LOCK".to_string())?;
    let wv = guard.as_ref().ok_or_else(|| "NOT_OPEN".to_string())?;
    let scale = if scale.is_finite() {
        scale.clamp(0.5, 2.0)
    } else {
        1.0
    };
    wv.set_zoom(scale).map_err(|e| e.to_string())
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

/// The page's own print dialog, for a waybill or label page. macOS needs the webview's native
/// print (WKWebView ignores the page's `window.print()`); elsewhere the fixed literal
/// `window.print()` is what the page's own Print button does.
#[tauri::command]
pub fn browser_print(state: tauri::State<'_, BrowserTabState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "LOCK".to_string())?;
    let wv = guard.as_ref().ok_or_else(|| "NOT_OPEN".to_string())?;
    #[cfg(target_os = "macos")]
    return wv.print().map_err(|e| e.to_string());
    #[cfg(not(target_os = "macos"))]
    wv.eval("window.print()").map_err(|e| e.to_string())
}

/// The seller's own "open this in my real browser" button: hands the address the tab shows to
/// the system browser, for a site that does not behave inside the app.
#[tauri::command]
pub fn browser_open_external(url: String) -> Result<(), String> {
    crate::browser::open_system(&normalize(&url)?)
}

/// Shows a downloaded file in Finder / Explorer.
#[tauri::command]
pub fn browser_reveal_download(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    // Only files this tab saved, i.e. inside the Downloads folder.
    if !p.starts_with(&dir) || !p.exists() {
        return Err("NOT_FOUND".into());
    }
    #[cfg(target_os = "windows")]
    let r = std::process::Command::new("explorer.exe")
        .arg(format!("/select,{}", p.display()))
        .spawn();
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg("-R").arg(&p).spawn();
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(&dir).spawn();
    r.map(|_| ()).map_err(|_| "OPEN_FAILED".to_string())
}

fn file_label(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
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
    #[test]
    fn encodes_base64_like_the_standard() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn upload_script_runs_only_on_myship() {
        let ok = |s: &str| is_myship(&url::Url::parse(s).unwrap());
        assert!(ok("https://myship.7-11.com.tw/seller/order"));
        assert!(ok("https://myship2.7-11.com.tw/"));
        assert!(!ok("http://myship.7-11.com.tw/"));
        assert!(!ok("https://evil.com/?x=7-11.com.tw"));
        assert!(!ok("https://not7-11.com.tw/"));
        let js = wrap_script("__LS.log(1);", "a\"b.xlsx", "Zm9v");
        assert!(js.contains(r#"name: "a\"b.xlsx""#));
        assert!(js.contains("__LS.log(1);"));
    }

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
    fn downloads_get_a_free_safe_name() {
        let dir = std::env::temp_dir().join(format!("lsdl-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(free_path(&dir, "phieu.pdf"), dir.join("phieu.pdf"));
        std::fs::write(dir.join("phieu.pdf"), b"x").unwrap();
        assert_eq!(free_path(&dir, "phieu.pdf"), dir.join("phieu (1).pdf"));
        assert_eq!(free_path(&dir, "../a/b:c.pdf"), dir.join("_a_b_c.pdf"));
        assert_eq!(free_path(&dir, ""), dir.join("download"));
        let u = url::Url::parse("https://x.tw/files/waybill.pdf?id=1").unwrap();
        assert_eq!(download_name(Path::new(""), &u), "waybill.pdf");
        assert_eq!(download_name(Path::new("/tmp/AB123.pdf"), &u), "AB123.pdf");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn keeps_the_tab_on_the_web_instead_of_an_app_or_store() {
        let u = |s: &str| url::Url::parse(s).unwrap();
        assert!(leaves_the_web(&u("snssdk1233://user/profile/1")));
        assert!(leaves_the_web(&u(
            "intent://user#Intent;scheme=snssdk1233;end"
        )));
        assert!(leaves_the_web(&u(
            "itms-apps://apps.apple.com/app/id835599320"
        )));
        assert!(leaves_the_web(&u(
            "https://apps.apple.com/app/tiktok/id835599320"
        )));
        assert!(leaves_the_web(&u(
            "https://play.google.com/store/apps/details?id=x"
        )));
        assert!(leaves_the_web(&u("https://tiktok.onelink.me/abc")));
        assert!(!leaves_the_web(&u("https://www.tiktok.com/@mai")));
        assert!(!leaves_the_web(&u("https://myship.7-11.com.tw/")));
        assert!(!leaves_the_web(&u("about:blank")));
    }

    #[test]
    fn rejects_empty_and_non_web_schemes() {
        assert!(normalize("").is_err());
        assert!(normalize("   ").is_err());
        assert!(normalize("javascript:alert(1)").is_err());
        assert!(normalize("file:///etc/passwd").is_err());
    }
}

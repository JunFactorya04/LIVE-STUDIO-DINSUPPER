//! Phone companion: the same screens, opened from a phone on the same Wi-Fi.
//!
//! A small HTTP server on the local network that (1) serves the app's own web assets and (2)
//! lets a page that knows the secret token call a fixed list of commands against the local
//! database. Off by default; the seller switches it on in Settings. Safety rules:
//!   * only peers on a private network address are served;
//!   * the `Host` header must be an IP address (no DNS names: rebinding protection);
//!   * every data call needs the random token, which changes each time sharing is started;
//!   * the command list below is closed: no API keys, no deleting data, no exports, no AI calls;
//!   * printing from the phone always goes to the printer the seller configured on the computer.
//! It is plain HTTP, so the token can be read by someone sniffing the same Wi-Fi: use it on a
//! network you trust.

use crate::commands;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Notify;

pub const FIRST_PORT: u16 = 47800;
pub const PORT_TRIES: u16 = 20;
const MAX_HEAD: usize = 16 * 1024;
const MAX_BODY: usize = 8 * 1024 * 1024;
const MAX_FAILS: u32 = 30;

/// Commands a phone may call. Anything else is refused.
pub const ALLOWED: &[&str] = &[
    "live_latest_session",
    "live_list_comments",
    "catalog_list",
    "order_save",
    "order_list",
    "order_set_status",
    "reply_create",
    "reply_list",
    "reply_update",
    "report_sessions",
    "biz_stock_list",
    "biz_purchase_list",
    "biz_expense_list",
    "ship_orders",
    "ship_order_save",
    "ship_order_delete",
    "ship_order_exported",
    "ship_customers",
    "ship_customer_save",
    "ship_customer_delete",
    "ship_stores_count",
    "ship_store_lookup",
    "ship_store_search",
    "flow_list",
    "flow_mark",
    "printer_print",
    "printer_config",
];

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrinterCfg {
    pub host: String,
    pub port: u16,
    pub width_dots: usize,
}

struct Running {
    token: String,
    port: u16,
    stop: Arc<Notify>,
}

#[derive(Default)]
pub struct ShareState {
    running: Mutex<Option<Running>>,
    printer: Arc<Mutex<Option<PrinterCfg>>>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShareInfo {
    pub running: bool,
    pub port: Option<u16>,
    /// Links to open on the phone (one per network address of this computer).
    pub urls: Vec<String>,
}

// ---------- pure helpers (tested) ----------

/// Private-network peers only: 10/8, 172.16/12, 192.168/16, link-local and loopback.
pub fn is_lan_peer(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => v.is_private() || v.is_loopback() || v.is_link_local(),
        IpAddr::V6(v) => v.is_loopback(),
    }
}

/// The Host header must be an IP address (with optional port) or `localhost`.
pub fn host_ok(host: Option<&str>) -> bool {
    let Some(h) = host else {
        return false;
    };
    let name = if let Some(rest) = h.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        h.rsplit_once(':').map(|(a, _)| a).unwrap_or(h)
    };
    name == "localhost" || name.parse::<IpAddr>().is_ok()
}

/// Compare without stopping at the first differing byte.
pub fn token_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

pub fn new_token() -> Result<String, String> {
    let mut buf = [0u8; 24];
    getrandom::getrandom(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

/// This computer's address on the local network (no packet is sent).
pub fn lan_ip() -> Option<IpAddr> {
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.0.2.1:9").ok()?;
    let ip = s.local_addr().ok()?.ip();
    (!ip.is_loopback() && !ip.is_unspecified()).then_some(ip)
}

pub struct Request {
    pub method: String,
    pub path: String,
    pub host: Option<String>,
    pub token: Option<String>,
    pub content_length: usize,
}

pub fn parse_head(head: &str) -> Option<Request> {
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split(' ');
    let method = first.next()?.to_string();
    let path = first.next()?.to_string();
    let (mut host, mut token, mut len) = (None, None, 0usize);
    for l in lines {
        if let Some((k, v)) = l.split_once(':') {
            let v = v.trim();
            match k.trim().to_ascii_lowercase().as_str() {
                "host" => host = Some(v.to_string()),
                "x-token" => token = Some(v.to_string()),
                "content-length" => len = v.parse().ok()?,
                _ => {}
            }
        }
    }
    Some(Request {
        method,
        path,
        host,
        token,
        content_length: len,
    })
}

// ---------- dispatch ----------

fn arg<T: DeserializeOwned>(a: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(a.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|_| format!("BAD_ARG_{key}"))
}

fn out<T: Serialize>(r: Result<T, String>) -> Result<Value, String> {
    r.and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
}

async fn dispatch(
    app: &AppHandle,
    printer: &Mutex<Option<PrinterCfg>>,
    cmd: &str,
    a: &Value,
) -> Result<Value, String> {
    if !ALLOWED.contains(&cmd) {
        return Err("FORBIDDEN".into());
    }
    match cmd {
        "live_latest_session" => out(commands::live_latest_session(app.state())),
        "live_list_comments" => out(commands::live_list_comments(
            app.state(),
            arg(a, "sessionId")?,
            arg(a, "limit")?,
        )),
        "catalog_list" => out(commands::catalog_list(app.state())),
        "order_save" => out(commands::order_save(app.state(), arg(a, "draft")?)),
        "order_list" => out(commands::order_list(app.state(), arg(a, "sessionId")?)),
        "order_set_status" => out(commands::order_set_status(
            app.state(),
            arg(a, "id")?,
            arg(a, "status")?,
            arg(a, "now")?,
        )),
        "reply_create" => out(commands::reply_create(app.state(), arg(a, "reply")?)),
        "reply_list" => out(commands::reply_list(app.state(), arg(a, "sessionId")?)),
        "reply_update" => out(commands::reply_update(
            app.state(),
            arg(a, "id")?,
            arg(a, "text")?,
            arg(a, "status")?,
            arg(a, "now")?,
        )),
        "report_sessions" => out(commands::report_sessions(app.state())),
        "ship_orders" => out(commands::ship_orders(app.state())),
        "ship_order_save" => out(commands::ship_order_save(
            app.state(),
            arg(a, "order")?,
            arg(a, "remember")?,
            arg(a, "now")?,
        )),
        "ship_order_delete" => out(commands::ship_order_delete(
            app.state(),
            arg(a, "id")?,
            arg(a, "now")?,
        )),
        "ship_order_exported" => out(commands::ship_order_exported(
            app.state(),
            arg(a, "ids")?,
            arg(a, "exported")?,
        )),
        // The books can be read from a phone (dashboard); changing them stays on the computer.
        "biz_stock_list" => out(commands::biz_stock_list(app.state())),
        "biz_purchase_list" => out(commands::biz_purchase_list(app.state())),
        "biz_expense_list" => out(commands::biz_expense_list(app.state())),
        "ship_customers" => out(commands::ship_customers(app.state())),
        "ship_customer_save" => out(commands::ship_customer_save(
            app.state(),
            arg(a, "customer")?,
            arg(a, "now")?,
        )),
        "ship_customer_delete" => out(commands::ship_customer_delete(
            app.state(),
            arg(a, "tiktokId")?,
        )),
        "ship_stores_count" => out(commands::ship_stores_count(app.state())),
        "ship_store_lookup" => out(commands::ship_store_lookup(app.state(), arg(a, "code")?)),
        "ship_store_search" => {
            out(commands::ship_store_search(app.state(), arg(a, "query")?).await)
        }
        "flow_list" => out(commands::flow_list(app.state())),
        "flow_mark" => out(commands::flow_mark(
            app.state(),
            arg(a, "tiktokId")?,
            arg(a, "step")?,
            arg(a, "now")?,
        )),
        "printer_config" => {
            let cfg = printer.lock().map_err(|_| "lock".to_string())?.clone();
            out(Ok(cfg))
        }
        "printer_print" => {
            // Always the printer chosen on the computer, never a host sent by the phone.
            let cfg = printer
                .lock()
                .map_err(|_| "lock".to_string())?
                .clone()
                .ok_or("NOT_CONFIGURED")?;
            out(commands::printer_print(
                app.state(),
                cfg.host,
                cfg.port,
                arg(a, "width")?,
                arg(a, "height")?,
                arg(a, "bits")?,
            )
            .await)
        }
        _ => Err("FORBIDDEN".into()),
    }
}

// ---------- HTTP ----------

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        429 => "Too Many Requests",
        _ => "Error",
    }
}

async fn reply(stream: &mut TcpStream, status: u16, ctype: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status} {}\r\ncontent-type: {ctype}\r\ncontent-length: {}\r\ncache-control: no-store\r\nx-content-type-options: nosniff\r\nreferrer-policy: no-referrer\r\nconnection: close\r\n\r\n",
        reason(status),
        body.len()
    );
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(body).await;
    let _ = stream.shutdown().await;
}

async fn handle(
    mut stream: TcpStream,
    peer: SocketAddr,
    app: AppHandle,
    token: String,
    printer: Arc<Mutex<Option<PrinterCfg>>>,
    fails: Arc<AtomicU32>,
) {
    if !is_lan_peer(peer.ip()) {
        return reply(&mut stream, 403, "text/plain", b"forbidden").await;
    }
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break p;
        }
        if buf.len() > MAX_HEAD {
            return reply(&mut stream, 413, "text/plain", b"too large").await;
        }
        match tokio::time::timeout(std::time::Duration::from_secs(10), stream.read(&mut chunk))
            .await
        {
            Ok(Ok(n)) if n > 0 => buf.extend_from_slice(&chunk[..n]),
            _ => return,
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let Some(req) = parse_head(&head) else {
        return reply(&mut stream, 400, "text/plain", b"bad request").await;
    };
    if !host_ok(req.host.as_deref()) {
        return reply(&mut stream, 403, "text/plain", b"forbidden").await;
    }
    let path = req.path.split('?').next().unwrap_or("/").to_string();

    if path.starts_with("/api/") {
        if fails.load(Ordering::Relaxed) >= MAX_FAILS {
            return reply(&mut stream, 429, "text/plain", b"locked").await;
        }
        let ok = req.token.as_deref().is_some_and(|t| token_eq(t, &token));
        if !ok {
            fails.fetch_add(1, Ordering::Relaxed);
            return reply(&mut stream, 401, "text/plain", b"unauthorized").await;
        }
        if path == "/api/ping" {
            return reply(&mut stream, 200, "application/json", b"{\"ok\":true}").await;
        }
        if path != "/api/invoke" || req.method != "POST" {
            return reply(&mut stream, 404, "text/plain", b"not found").await;
        }
        if req.content_length > MAX_BODY {
            return reply(&mut stream, 413, "text/plain", b"too large").await;
        }
        let mut body = buf[head_end + 4..].to_vec();
        while body.len() < req.content_length {
            match tokio::time::timeout(std::time::Duration::from_secs(15), stream.read(&mut chunk))
                .await
            {
                Ok(Ok(n)) if n > 0 => body.extend_from_slice(&chunk[..n]),
                _ => return,
            }
        }
        body.truncate(req.content_length);
        let parsed: Result<Value, _> = serde_json::from_slice(&body);
        let (status, payload) = match parsed {
            Ok(v) => {
                let cmd = v
                    .get("cmd")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let args = v.get("args").cloned().unwrap_or(Value::Null);
                match dispatch(&app, &printer, &cmd, &args).await {
                    Ok(data) => (200, json!({ "ok": true, "data": data })),
                    Err(e) => (200, json!({ "ok": false, "error": e })),
                }
            }
            Err(_) => (400, json!({ "ok": false, "error": "BAD_JSON" })),
        };
        return reply(
            &mut stream,
            status,
            "application/json",
            payload.to_string().as_bytes(),
        )
        .await;
    }

    // Static assets of the app itself (no data in them).
    if req.method != "GET" && req.method != "HEAD" {
        return reply(&mut stream, 405, "text/plain", b"method not allowed").await;
    }
    let want = if path == "/" {
        "/index.html"
    } else {
        path.as_str()
    };
    let resolver = app.asset_resolver();
    let asset = resolver.get(want.to_string()).or_else(|| {
        (!want.contains('.'))
            .then(|| resolver.get("/index.html".into()))
            .flatten()
    });
    match asset {
        Some(a) => reply(&mut stream, 200, &a.mime_type, &a.bytes).await,
        None => reply(&mut stream, 404, "text/plain", b"not found").await,
    }
}

async fn serve(
    listener: std::net::TcpListener,
    app: AppHandle,
    token: String,
    stop: Arc<Notify>,
    printer: Arc<Mutex<Option<PrinterCfg>>>,
) {
    let Ok(listener) = TcpListener::from_std(listener) else {
        return;
    };
    let fails = Arc::new(AtomicU32::new(0));
    loop {
        tokio::select! {
            _ = stop.notified() => break,
            accepted = listener.accept() => {
                let Ok((stream, peer)) = accepted else { continue };
                tokio::spawn(handle(
                    stream,
                    peer,
                    app.clone(),
                    token.clone(),
                    printer.clone(),
                    fails.clone(),
                ));
            }
        }
    }
}

// ---------- start / stop (called from the desktop window only) ----------

fn bind() -> std::io::Result<std::net::TcpListener> {
    let mut last = None;
    for p in FIRST_PORT..FIRST_PORT + PORT_TRIES {
        match std::net::TcpListener::bind(("0.0.0.0", p)) {
            Ok(l) => {
                l.set_nonblocking(true)?;
                return Ok(l);
            }
            Err(e) => last = Some(e),
        }
    }
    Err(last.unwrap_or_else(|| std::io::Error::other("no port")))
}

fn info(r: &Option<Running>) -> ShareInfo {
    match r {
        None => ShareInfo {
            running: false,
            port: None,
            urls: vec![],
        },
        Some(r) => ShareInfo {
            running: true,
            port: Some(r.port),
            urls: lan_ip()
                .map(|ip| vec![format!("http://{ip}:{}/?t={}", r.port, r.token)])
                .unwrap_or_default(),
        },
    }
}

pub fn start(app: &AppHandle, state: &ShareState) -> Result<ShareInfo, String> {
    let mut guard = state.running.lock().map_err(|_| "lock".to_string())?;
    if guard.is_some() {
        return Ok(info(&guard));
    }
    let listener = bind().map_err(|_| "NO_PORT".to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = new_token()?;
    let stop = Arc::new(Notify::new());
    tauri::async_runtime::spawn(serve(
        listener,
        app.clone(),
        token.clone(),
        stop.clone(),
        state.printer.clone(),
    ));
    *guard = Some(Running { token, port, stop });
    Ok(info(&guard))
}

pub fn stop(state: &ShareState) -> Result<ShareInfo, String> {
    let mut guard = state.running.lock().map_err(|_| "lock".to_string())?;
    if let Some(r) = guard.take() {
        r.stop.notify_one();
    }
    Ok(info(&guard))
}

pub fn status(state: &ShareState) -> Result<ShareInfo, String> {
    let guard = state.running.lock().map_err(|_| "lock".to_string())?;
    Ok(info(&guard))
}

pub fn set_printer(state: &ShareState, cfg: Option<PrinterCfg>) -> Result<(), String> {
    *state.printer.lock().map_err(|_| "lock".to_string())? = cfg;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_private_peers() {
        for ok in [
            "192.168.1.20",
            "10.0.0.5",
            "172.16.3.4",
            "127.0.0.1",
            "169.254.1.1",
        ] {
            assert!(is_lan_peer(ok.parse().unwrap()), "{ok}");
        }
        for bad in ["8.8.8.8", "172.32.0.1", "1.1.1.1", "203.0.113.9"] {
            assert!(!is_lan_peer(bad.parse().unwrap()), "{bad}");
        }
    }

    #[test]
    fn host_must_be_an_ip_or_localhost() {
        assert!(host_ok(Some("192.168.1.20:47800")));
        assert!(host_ok(Some("localhost:47800")));
        assert!(host_ok(Some("[::1]:47800")));
        assert!(!host_ok(Some("evil.example.com:47800")));
        assert!(!host_ok(Some("evil.example.com")));
        assert!(!host_ok(None));
    }

    #[test]
    fn tokens_compare_exactly() {
        assert!(token_eq("abc123", "abc123"));
        assert!(!token_eq("abc123", "abc124"));
        assert!(!token_eq("abc", "abc123"));
        let t = new_token().unwrap();
        assert_eq!(t.len(), 48);
        assert_ne!(t, new_token().unwrap());
    }

    #[test]
    fn parses_the_request_head() {
        let r = parse_head(
            "POST /api/invoke HTTP/1.1\r\nHost: 192.168.1.2:47800\r\nX-Token: abc\r\nContent-Length: 12",
        )
        .unwrap();
        assert_eq!(
            (r.method.as_str(), r.path.as_str()),
            ("POST", "/api/invoke")
        );
        assert_eq!(r.host.as_deref(), Some("192.168.1.2:47800"));
        assert_eq!(r.token.as_deref(), Some("abc"));
        assert_eq!(r.content_length, 12);
        assert!(parse_head("").is_none());
    }

    #[test]
    fn the_command_list_has_nothing_dangerous() {
        for cmd in [
            "secret_set",
            "secret_remove",
            "ai_complete",
            "euler_connect",
            "data_delete_all",
            "data_export",
            "data_backup",
            "data_purge_older",
            "live_delete_session",
            "live_delete_comments",
            "ship_export_xlsx",
            "ship_stores_import",
            "overlay_set",
            "share_start",
            "biz_stock_save",
            "biz_purchase_add",
            "biz_purchase_delete",
            "biz_expense_save",
            "biz_expense_delete",
            "secret_exists",
            "ecpay_check",
            "ecpay_create",
            "ecpay_query",
            "open_carrier_page",
        ] {
            assert!(
                !ALLOWED.contains(&cmd),
                "{cmd} must not be callable from a phone"
            );
        }
    }
}

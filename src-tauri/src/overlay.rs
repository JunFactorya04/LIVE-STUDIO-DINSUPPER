//! Local product overlay for a Browser Source (OBS, TikTok LIVE Studio...). A tiny HTTP server
//! on 127.0.0.1 only. It can show nothing but the fields of `OverlayState` (product name, SKU,
//! price text, colors, sizes, promo text chosen by the seller). Comments and usernames have no
//! way into it, so personal data cannot leak by construction.

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

pub const FIRST_PORT: u16 = 17891;
pub const PORT_TRIES: u16 = 10;
const MAX_REQUEST_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct OverlayState {
    pub visible: bool,
    pub name: String,
    pub sku: String,
    pub price_text: String,
    pub colors: Vec<String>,
    pub sizes: Vec<String>,
    pub promo: String,
}

pub type SharedOverlay = Arc<Mutex<OverlayState>>;

fn text(s: &str, max: usize) -> String {
    s.chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .chars()
        .take(max)
        .collect()
}

fn list(v: &[String]) -> Vec<String> {
    v.iter()
        .map(|s| text(s, 40))
        .filter(|s| !s.is_empty())
        .take(12)
        .collect()
}

/// Trim, strip control characters and cap every field.
pub fn sanitize(s: &OverlayState) -> OverlayState {
    OverlayState {
        visible: s.visible,
        name: text(&s.name, 80),
        sku: text(&s.sku, 64),
        price_text: text(&s.price_text, 24),
        colors: list(&s.colors),
        sizes: list(&s.sizes),
        promo: text(&s.promo, 120),
    }
}

pub struct Response {
    pub status: u16,
    pub content_type: &'static str,
    pub body: String,
}

fn resp(status: u16, content_type: &'static str, body: impl Into<String>) -> Response {
    Response {
        status,
        content_type,
        body: body.into(),
    }
}

/// Pure routing, so it can be tested without sockets.
pub fn route(
    method: &str,
    path: &str,
    host: Option<&str>,
    port: u16,
    state: &OverlayState,
) -> Response {
    // Host check against DNS-rebinding: only our own loopback names are served.
    let ok_host = matches!(host, Some(h) if h == format!("127.0.0.1:{port}") || h == format!("localhost:{port}"));
    if !ok_host {
        return resp(403, "text/plain; charset=utf-8", "forbidden");
    }
    if method != "GET" && method != "HEAD" {
        return resp(405, "text/plain; charset=utf-8", "method not allowed");
    }
    match path.split('?').next().unwrap_or("") {
        "/overlay/live-product" => resp(200, "text/html; charset=utf-8", PAGE),
        "/overlay/data.json" => {
            // A hidden overlay publishes nothing but the flag.
            let body = if state.visible {
                serde_json::to_string(state).unwrap_or_else(|_| "{\"visible\":false}".into())
            } else {
                "{\"visible\":false}".to_string()
            };
            resp(200, "application/json", body)
        }
        _ => resp(404, "text/plain; charset=utf-8", "not found"),
    }
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Bad Request",
    }
}

async fn handle(mut stream: TcpStream, port: u16, shared: SharedOverlay) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    while buf.len() < MAX_REQUEST_BYTES && !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        match tokio::time::timeout(std::time::Duration::from_secs(5), stream.read(&mut chunk)).await
        {
            Ok(Ok(n)) if n > 0 => buf.extend_from_slice(&chunk[..n]),
            _ => break,
        }
    }
    let head = String::from_utf8_lossy(&buf).to_string();
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or("").split(' ');
    let (method, path) = (first.next().unwrap_or(""), first.next().unwrap_or(""));
    let host = lines
        .find_map(|l| {
            l.split_once(':')
                .filter(|(k, _)| k.eq_ignore_ascii_case("host"))
        })
        .map(|(_, v)| v.trim().to_string());
    let state = shared.lock().map(|s| s.clone()).unwrap_or_default();
    let r = if method.is_empty() {
        resp(400, "text/plain; charset=utf-8", "bad request")
    } else {
        route(method, path, host.as_deref(), port, &state)
    };
    let body = if method == "HEAD" {
        ""
    } else {
        r.body.as_str()
    };
    let out = format!(
        "HTTP/1.1 {} {}\r\ncontent-type: {}\r\ncontent-length: {}\r\ncache-control: no-store\r\nx-content-type-options: nosniff\r\ncontent-security-policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'\r\nconnection: close\r\n\r\n{}",
        r.status,
        reason(r.status),
        r.content_type,
        r.body.len(),
        body
    );
    let _ = stream.write_all(out.as_bytes()).await;
    let _ = stream.shutdown().await;
}

/// Bind the first free port on 127.0.0.1 starting at `first`.
pub fn bind(first: u16) -> std::io::Result<std::net::TcpListener> {
    let mut last = None;
    for p in first..first.saturating_add(PORT_TRIES) {
        match std::net::TcpListener::bind(("127.0.0.1", p)) {
            Ok(l) => {
                l.set_nonblocking(true)?;
                return Ok(l);
            }
            Err(e) => last = Some(e),
        }
    }
    Err(last.unwrap_or_else(|| std::io::Error::other("no port")))
}

/// Serve forever on an already bound listener (call from inside the async runtime).
pub async fn serve(listener: std::net::TcpListener, shared: SharedOverlay) {
    let Ok(port) = listener.local_addr().map(|a| a.port()) else {
        return;
    };
    let Ok(listener) = TcpListener::from_std(listener) else {
        return;
    };
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            continue;
        };
        tokio::spawn(handle(stream, port, shared.clone()));
    }
}

const PAGE: &str = r#"<!doctype html>
<html lang="zh-TW"><head><meta charset="utf-8"><title>LIVE STUDIO overlay</title>
<style>
html,body{margin:0;background:transparent;font-family:-apple-system,"SF Pro Text","Segoe UI","Noto Sans TC",sans-serif;color:#fff}
#card{display:none;margin:24px;padding:18px 22px;max-width:520px;border-radius:18px;background:rgba(20,20,24,.78);box-shadow:0 8px 30px rgba(0,0,0,.35)}
#name{font-size:32px;font-weight:700;line-height:1.2}
#meta{margin-top:6px;font-size:18px;opacity:.8}
#price{margin-top:10px;font-size:44px;font-weight:800;color:#ffd60a}
.tags{margin-top:10px;display:flex;flex-wrap:wrap;gap:8px}
.tags span{padding:4px 12px;border-radius:999px;background:rgba(255,255,255,.18);font-size:18px}
#promo{margin-top:12px;font-size:22px;font-weight:600;color:#30d158}
</style></head><body>
<div id="card"><div id="name"></div><div id="meta"></div><div id="price"></div>
<div class="tags" id="colors"></div><div class="tags" id="sizes"></div><div id="promo"></div></div>
<script>
const $=id=>document.getElementById(id);
function tags(el,list){el.textContent="";for(const t of list||[]){const s=document.createElement("span");s.textContent=t;el.appendChild(s)}}
async function tick(){
  try{
    const d=await (await fetch("/overlay/data.json",{cache:"no-store"})).json();
    $("card").style.display=d.visible?"block":"none";
    if(d.visible){
      $("name").textContent=d.name||"";$("meta").textContent=d.sku||"";$("price").textContent=d.priceText||"";
      tags($("colors"),d.colors);tags($("sizes"),d.sizes);$("promo").textContent=d.promo||"";
    }
  }catch(e){}
}
tick();setInterval(tick,1000);
</script></body></html>"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn shown() -> OverlayState {
        OverlayState {
            visible: true,
            name: "黑色連帽衫".into(),
            sku: "A12".into(),
            price_text: "NT$790".into(),
            colors: vec!["黑色".into()],
            sizes: vec!["M".into(), "L".into()],
            promo: "第二件 9 折".into(),
        }
    }

    #[test]
    fn sanitize_caps_and_cleans() {
        let dirty = OverlayState {
            visible: true,
            name: format!("  A\u{0}B\n{}", "x".repeat(200)),
            sku: " s ".into(),
            price_text: "y".repeat(100),
            colors: (0..30)
                .map(|i| format!(" c{i} "))
                .chain(["  ".to_string()])
                .collect(),
            sizes: vec![],
            promo: "z".repeat(500),
        };
        let c = sanitize(&dirty);
        assert!(c.name.starts_with("AB") && c.name.chars().count() == 80);
        assert_eq!(c.sku, "s");
        assert_eq!(c.price_text.chars().count(), 24);
        assert_eq!(c.colors.len(), 12);
        assert_eq!(c.colors[0], "c0");
        assert_eq!(c.promo.chars().count(), 120);
    }

    #[test]
    fn routes_and_host_check() {
        let s = shown();
        assert_eq!(
            route("GET", "/overlay/live-product", Some("127.0.0.1:1"), 1, &s).status,
            200
        );
        assert_eq!(
            route(
                "GET",
                "/overlay/live-product?x=1",
                Some("localhost:1"),
                1,
                &s
            )
            .status,
            200
        );
        assert_eq!(
            route(
                "GET",
                "/overlay/live-product",
                Some("evil.example:1"),
                1,
                &s
            )
            .status,
            403
        );
        assert_eq!(
            route("GET", "/overlay/live-product", None, 1, &s).status,
            403
        );
        assert_eq!(
            route("POST", "/overlay/data.json", Some("127.0.0.1:1"), 1, &s).status,
            405
        );
        assert_eq!(
            route("GET", "/etc/passwd", Some("127.0.0.1:1"), 1, &s).status,
            404
        );
    }

    #[test]
    fn hidden_overlay_publishes_nothing_and_data_has_only_product_fields() {
        let mut s = shown();
        let r = route("GET", "/overlay/data.json", Some("127.0.0.1:1"), 1, &s);
        let v: serde_json::Value = serde_json::from_str(&r.body).unwrap();
        let mut keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "colors",
                "name",
                "priceText",
                "promo",
                "sizes",
                "sku",
                "visible"
            ]
        );
        s.visible = false;
        let r = route("GET", "/overlay/data.json", Some("127.0.0.1:1"), 1, &s);
        assert_eq!(r.body, "{\"visible\":false}");
    }

    #[test]
    fn page_uses_text_content_only() {
        assert!(!PAGE.contains("innerHTML"));
        assert!(PAGE.contains("textContent"));
    }

    #[tokio::test]
    async fn real_server_on_loopback() {
        let shared: SharedOverlay = Arc::new(Mutex::new(sanitize(&shown())));
        let l = bind(FIRST_PORT + 50).unwrap();
        let port = l.local_addr().unwrap().port();
        assert_eq!(l.local_addr().unwrap().ip().to_string(), "127.0.0.1");
        tokio::spawn(serve(l, shared.clone()));

        async fn get(port: u16, path: &str, host: &str) -> String {
            let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            let req = format!("GET {path} HTTP/1.1\r\nHost: {host}\r\n\r\n");
            s.write_all(req.as_bytes()).await.unwrap();
            let mut out = String::new();
            s.read_to_string(&mut out).await.unwrap();
            out
        }
        let host = format!("127.0.0.1:{port}");
        let page = get(port, "/overlay/live-product", &host).await;
        assert!(page.starts_with("HTTP/1.1 200") && page.contains("<title>LIVE STUDIO overlay"));
        let data = get(port, "/overlay/data.json", &host).await;
        assert!(data.contains("\"sku\":\"A12\"") && data.contains("NT$790"));
        shared.lock().unwrap().visible = false;
        assert!(get(port, "/overlay/data.json", &host)
            .await
            .ends_with("{\"visible\":false}"));
        assert!(get(port, "/overlay/data.json", "evil.example")
            .await
            .starts_with("HTTP/1.1 403"));
    }
}

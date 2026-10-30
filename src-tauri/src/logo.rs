//! Carrier logos: fetched at run time, on this computer, from each carrier's own official site,
//! so nothing of theirs is bundled with the app. Only a fixed list of sites is ever contacted;
//! the icon address comes from that site's page and must be a public https address.

use base64::Engine;
use std::net::IpAddr;
use url::Url;

pub const MAX_BYTES: usize = 200_000;
const MAX_PAGE: usize = 512_000;

/// Official home page of each carrier the app knows (ids match `src/carriers/registry.ts`).
pub fn site(id: &str) -> Option<&'static str> {
    Some(match id {
        "ecpay" => "https://www.ecpay.com.tw/",
        "seven" => "https://myship.7-11.com.tw/",
        "family" => "https://www.family.com.tw/",
        "shopee" => "https://shopee.tw/",
        "tcat" => "https://www.t-cat.com.tw/",
        "hct" => "https://www.hct.com.tw/",
        "post" => "https://www.post.gov.tw/",
        _ => return None,
    })
}

/// Only public https hosts: no IP addresses, no localhost, no single-label names.
pub fn is_public_https(u: &Url) -> bool {
    u.scheme() == "https"
        && u.host_str().is_some_and(|h| {
            h.parse::<IpAddr>().is_err() && h.contains('.') && !h.ends_with(".local")
        })
}

fn attr(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let key = format!("{name}=");
    let at = lower.find(&key)?;
    let rest = &tag[at + key.len()..];
    let quote = rest.chars().next().filter(|c| *c == '"' || *c == '\'')?;
    let end = rest[1..].find(quote)?;
    Some(rest[1..1 + end].to_string())
}

/// Icon addresses from the page's `<link rel="...icon...">` tags, best first: touch icons, then
/// larger sizes, then the plain favicon. `/favicon.ico` is always the last resort.
pub fn icon_candidates(html: &str, base: &Url) -> Vec<Url> {
    let mut found: Vec<(i32, Url)> = Vec::new();
    let lower = html.to_ascii_lowercase();
    let mut from = 0;
    while let Some(i) = lower[from..].find("<link") {
        let start = from + i;
        let Some(end) = lower[start..].find('>') else {
            break;
        };
        let tag = &html[start..start + end];
        from = start + end;
        let rel = attr(tag, "rel").unwrap_or_default().to_ascii_lowercase();
        if !rel.contains("icon") {
            continue;
        }
        let Some(href) = attr(tag, "href") else {
            continue;
        };
        let Ok(url) = base.join(&href) else {
            continue;
        };
        let size = attr(tag, "sizes")
            .and_then(|s| s.split('x').next().and_then(|n| n.parse::<i32>().ok()))
            .unwrap_or(0);
        let score = if rel.contains("apple-touch") { 1000 } else { 0 } + size.min(512);
        found.push((score, url));
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    let mut out: Vec<Url> = found.into_iter().map(|(_, u)| u).collect();
    if let Ok(f) = base.join("/favicon.ico") {
        out.push(f);
    }
    out.dedup();
    out.retain(is_public_https);
    out
}

pub fn image_type_ok(content_type: &str) -> bool {
    let t = content_type.split(';').next().unwrap_or("").trim();
    matches!(
        t,
        "image/png"
            | "image/jpeg"
            | "image/svg+xml"
            | "image/webp"
            | "image/x-icon"
            | "image/vnd.microsoft.icon"
    )
}

pub fn data_url(content_type: &str, bytes: &[u8]) -> String {
    let t = content_type.split(';').next().unwrap_or("image/png").trim();
    format!(
        "data:{t};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

/// Download the logo of a carrier as a `data:` URL.
pub async fn fetch(id: &str) -> Result<String, String> {
    let home = site(id).ok_or("UNKNOWN")?;
    let base = Url::parse(home).map_err(|_| "UNKNOWN")?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent("Mozilla/5.0 LIVE-STUDIO")
        .build()
        .map_err(|_| "NETWORK")?;
    let page = client.get(home).send().await.map_err(|_| "NETWORK")?;
    let page_url = page.url().clone();
    let html = if page.status().is_success() {
        let b = page.bytes().await.map_err(|_| "NETWORK")?;
        String::from_utf8_lossy(&b[..b.len().min(MAX_PAGE)]).into_owned()
    } else {
        String::new()
    };
    let base = if is_public_https(&page_url) {
        page_url
    } else {
        base
    };
    for url in icon_candidates(&html, &base).into_iter().take(6) {
        let Ok(resp) = client.get(url).send().await else {
            continue;
        };
        if !resp.status().is_success() || !is_public_https(resp.url()) {
            continue;
        }
        let ct = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        if !image_type_ok(&ct) {
            continue;
        }
        let Ok(bytes) = resp.bytes().await else {
            continue;
        };
        if !bytes.is_empty() && bytes.len() <= MAX_BYTES {
            return Ok(data_url(&ct, &bytes));
        }
    }
    Err("NOT_FOUND".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_carriers_have_a_site() {
        assert!(site("tcat").is_some());
        assert!(site("evil").is_none());
        assert!(site("../x").is_none());
    }

    #[test]
    fn picks_touch_icons_first_and_always_ends_with_favicon() {
        let base = Url::parse("https://www.example.com.tw/").unwrap();
        let html = r#"<head><link rel="icon" href="/a.png" sizes="32x32">
            <LINK REL="apple-touch-icon" HREF='/touch.png' sizes="180x180">
            <link rel="stylesheet" href="/x.css"></head>"#;
        let c = icon_candidates(html, &base);
        assert_eq!(c[0].as_str(), "https://www.example.com.tw/touch.png");
        assert_eq!(c[1].as_str(), "https://www.example.com.tw/a.png");
        assert_eq!(
            c.last().unwrap().as_str(),
            "https://www.example.com.tw/favicon.ico"
        );
    }

    #[test]
    fn refuses_private_or_plain_http_icon_addresses() {
        let base = Url::parse("https://www.example.com.tw/").unwrap();
        let html = r#"<link rel="icon" href="http://evil.example/a.png">
            <link rel="icon" href="https://192.168.1.1/a.png">
            <link rel="icon" href="https://localhost/a.png">"#;
        let c = icon_candidates(html, &base);
        assert_eq!(c.len(), 1);
        assert!(c[0].as_str().ends_with("/favicon.ico"));
    }

    #[test]
    fn accepts_only_image_types_and_builds_a_data_url() {
        assert!(image_type_ok("image/png; charset=binary"));
        assert!(!image_type_ok("text/html"));
        assert_eq!(data_url("image/png", b"ab"), "data:image/png;base64,YWI=");
    }
}

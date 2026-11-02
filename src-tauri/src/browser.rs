//! Open a carrier's (or ad platform's) own web page in the system browser. Only https addresses
//! on a fixed list of domains are opened, and the address is passed as one argument (no shell).

use std::process::Command;
use url::Url;

const HOSTS: [&str; 11] = [
    "ecpay.com.tw",
    "7-11.com.tw",
    "family.com.tw",
    "famiport.com.tw",
    "shopee.tw",
    "t-cat.com.tw",
    "hct.com.tw",
    "post.gov.tw",
    // Ad platforms' own developer-app registration pages (Quảng cáo tab).
    "tiktok.com",
    "facebook.com",
    "google.com",
];

pub fn allowed(url: &str) -> Option<Url> {
    let u = Url::parse(url).ok()?;
    let host = u.host_str()?;
    let ok = u.scheme() == "https"
        && HOSTS
            .iter()
            .any(|h| host == *h || host.ends_with(&format!(".{h}")));
    ok.then_some(u)
}

pub fn open_carrier(url: &str) -> Result<(), String> {
    let u = allowed(url).ok_or_else(|| "NOT_ALLOWED".to_string())?;
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("explorer.exe");
        c.arg(u.as_str());
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(u.as_str());
        c
    };
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(u.as_str());
        c
    };
    cmd.spawn()
        .map(|_| ())
        .map_err(|_| "OPEN_FAILED".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_https_carrier_pages() {
        assert!(allowed("https://vendor.ecpay.com.tw/").is_some());
        assert!(allowed("https://myship.7-11.com.tw/Home/Main").is_some());
        assert!(allowed("http://www.hct.com.tw/").is_none());
        assert!(allowed("https://evil.com/?u=hct.com.tw").is_none());
        assert!(allowed("https://nothct.com.tw/").is_none());
        assert!(allowed("file:///etc/passwd").is_none());
        assert!(allowed("javascript:alert(1)").is_none());
    }

    #[test]
    fn ad_platform_console_pages_are_allowed() {
        assert!(allowed("https://ads.tiktok.com/marketing_api/homepage").is_some());
        assert!(allowed("https://developers.facebook.com/apps/").is_some());
        assert!(allowed("https://ads.google.com/aw/apicenter").is_some());
        assert!(allowed("https://evil.com/?u=google.com").is_none());
    }
}

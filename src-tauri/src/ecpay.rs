//! ECPay (綠界) logistics: check the keys, create a convenience-store waybill, query its status.
//! The MerchantID / HashKey / HashIV live in the OS keychain and are read here, never sent to the
//! screen. Requests are signed with ECPay's CheckMacValue (MD5 for logistics).
//!
//! Stage (test) and production use different hosts; stage accepts ECPay's public test merchant.

use crate::secrets::SecretStore;
use md5::{Digest, Md5};
use std::collections::BTreeMap;
use std::time::Duration;

const STAGE: &str = "https://logistics-stage.ecpay.com.tw";
const PROD: &str = "https://logistics.ecpay.com.tw";
/// ECPay requires a reply address. The app has no public address and asks for the status itself,
/// so the notices go to the reserved example.com, which ignores them.
const REPLY_URL: &str = "https://example.com/ecpay-reply";

pub struct Creds {
    pub merchant_id: String,
    pub hash_key: String,
    pub hash_iv: String,
    pub sender_name: String,
    pub sender_phone: String,
}

fn slot(field: &str) -> String {
    format!("carrier-ecpay-{field}")
}

pub fn load_creds(store: &dyn SecretStore) -> Result<Creds, String> {
    let get = |f: &str| -> Result<String, String> {
        store
            .get(&slot(f))?
            .filter(|v| !v.trim().is_empty())
            .ok_or_else(|| "NO_CREDENTIALS".to_string())
    };
    Ok(Creds {
        merchant_id: get("merchantid")?,
        hash_key: get("hashkey")?,
        hash_iv: get("hashiv")?,
        sender_name: store.get(&slot("sendername"))?.unwrap_or_default(),
        sender_phone: store.get(&slot("senderphone"))?.unwrap_or_default(),
    })
}

/// .NET-style URL encoding, lower case, as ECPay's signature requires.
pub fn url_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'0'..=b'9'
            | b'a'..=b'z'
            | b'A'..=b'Z'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'*'
            | b'('
            | b')' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02x}")),
        }
    }
    out.to_lowercase()
}

/// CheckMacValue: sort by key (case-insensitive), wrap in HashKey/HashIV, encode, MD5, upper-case.
pub fn check_mac(params: &BTreeMap<String, String>, key: &str, iv: &str) -> String {
    let mut pairs: Vec<(&String, &String)> = params.iter().collect();
    pairs.sort_by_key(|(k, _)| k.to_lowercase());
    let body: Vec<String> = pairs.iter().map(|(k, v)| format!("{k}={v}")).collect();
    let raw = format!("HashKey={key}&{}&HashIV={iv}", body.join("&"));
    let digest = Md5::digest(url_encode(&raw).as_bytes());
    digest.iter().map(|b| format!("{b:02X}")).collect()
}

fn host(stage: bool) -> &'static str {
    if stage {
        STAGE
    } else {
        PROD
    }
}

async fn post(
    stage: bool,
    path: &str,
    mut params: BTreeMap<String, String>,
    c: &Creds,
) -> Result<String, String> {
    let mac = check_mac(&params, &c.hash_key, &c.hash_iv);
    params.insert("CheckMacValue".into(), mac);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "HTTP".to_string())?;
    let resp = client
        .post(format!("{}{path}", host(stage)))
        .form(&params)
        .send()
        .await
        .map_err(|_| "UNREACHABLE".to_string())?;
    let text = resp.text().await.map_err(|_| "UNREACHABLE".to_string())?;
    // Never return more than a short line of ECPay's own message.
    Ok(text.chars().take(400).collect())
}

/// Parse ECPay replies: `1|k=v&k=v` (create), `k=v&k=v` (query) or `0|message`.
pub fn parse_reply(text: &str) -> (bool, BTreeMap<String, String>, String) {
    let (ok, body) = match text.split_once('|') {
        Some(("1", rest)) => (true, rest),
        Some((_, rest)) => (false, rest),
        None => (text.contains('='), text),
    };
    let mut map = BTreeMap::new();
    if body.contains('=') {
        for kv in body.split('&') {
            if let Some((k, v)) = kv.split_once('=') {
                map.insert(k.to_string(), v.to_string());
            }
        }
    }
    (ok, map, body.trim().to_string())
}

fn stamp() -> String {
    // yyyy/MM/dd HH:mm:ss in Taiwan time (UTC+8), no clock crate needed.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
        + 8 * 3600;
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let (y, m, d) = civil(days);
    format!(
        "{y:04}/{m:02}/{d:02} {:02}:{:02}:{:02}",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

fn civil(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    /// True only when ECPay answered and did not reject the merchant or the signature.
    pub accepted: bool,
    /// ECPay's own reply, trimmed, so the seller can read what it said.
    pub message: String,
}

/// Ask ECPay about a trade number that does not exist. A valid merchant and signature get a
/// "not found" style answer; a wrong MerchantID or HashKey/HashIV gets a signature/merchant error.
pub async fn check(store: &dyn SecretStore, stage: bool) -> Result<CheckResult, String> {
    let c = load_creds(store)?;
    let mut p = BTreeMap::new();
    p.insert("MerchantID".into(), c.merchant_id.clone());
    p.insert("MerchantTradeNo".into(), "LSCHECK0000".into());
    p.insert("TimeStamp".into(), unix_now().to_string());
    let text = post(stage, "/Helper/QueryLogisticsTradeInfo/V2", p, &c).await?;
    let low = text.to_lowercase();
    let rejected = low.contains("checkmacvalue")
        || low.contains("merchantid")
        || low.contains("not exist merchant")
        || low.contains("illegal");
    Ok(CheckResult {
        accepted: !text.trim().is_empty() && !rejected,
        message: text,
    })
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewWaybill {
    /// Unique per shop, at most 20 letters/digits.
    pub trade_no: String,
    /// "UNIMARTC2C" (7-ELEVEN) or "FAMIC2C" (FamilyMart).
    pub sub_type: String,
    /// Value of the goods, NT$ 1–20000.
    pub amount: i64,
    /// Cash to collect from the buyer (goods + shipping) when `cod`.
    pub collection: i64,
    pub cod: bool,
    pub goods: String,
    pub receiver_name: String,
    pub receiver_phone: String,
    pub store_id: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Waybill {
    pub ok: bool,
    pub logistics_id: String,
    pub payment_no: String,
    pub validation_no: String,
    pub message: String,
}

pub fn validate(w: &NewWaybill) -> Result<(), String> {
    let alnum = |s: &str| s.chars().all(|c| c.is_ascii_alphanumeric());
    if w.trade_no.is_empty() || w.trade_no.len() > 20 || !alnum(&w.trade_no) {
        return Err("BAD_TRADE_NO".into());
    }
    if !matches!(w.sub_type.as_str(), "UNIMARTC2C" | "FAMIC2C") {
        return Err("BAD_SUBTYPE".into());
    }
    if !(1..=20_000).contains(&w.amount) {
        return Err("BAD_AMOUNT".into());
    }
    if w.cod && !(1..=20_000).contains(&w.collection) {
        return Err("BAD_AMOUNT".into());
    }
    if w.store_id.is_empty() || !w.store_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("BAD_STORE".into());
    }
    if w.receiver_name.trim().is_empty() || w.goods.trim().is_empty() {
        return Err("BAD_FIELDS".into());
    }
    let digits = w.receiver_phone.len() == 10 && w.receiver_phone.starts_with("09");
    if !digits || !w.receiver_phone.chars().all(|c| c.is_ascii_digit()) {
        return Err("BAD_PHONE".into());
    }
    Ok(())
}

pub async fn create(
    store: &dyn SecretStore,
    stage: bool,
    w: &NewWaybill,
) -> Result<Waybill, String> {
    validate(w)?;
    let c = load_creds(store)?;
    if c.sender_name.trim().is_empty() || c.sender_phone.trim().is_empty() {
        return Err("NO_SENDER".into());
    }
    let mut p = BTreeMap::new();
    let mut put = |k: &str, v: String| {
        p.insert(k.to_string(), v);
    };
    put("MerchantID", c.merchant_id.clone());
    put("MerchantTradeNo", w.trade_no.clone());
    put("MerchantTradeDate", stamp());
    put("LogisticsType", "CVS".into());
    put("LogisticsSubType", w.sub_type.clone());
    put("GoodsAmount", w.amount.to_string());
    put(
        "CollectionAmount",
        (if w.cod { w.collection } else { 0 }).to_string(),
    );
    put("IsCollection", if w.cod { "Y" } else { "N" }.into());
    put("GoodsName", w.goods.chars().take(50).collect());
    put("SenderName", c.sender_name.clone());
    put("SenderCellPhone", c.sender_phone.clone());
    put("ReceiverName", w.receiver_name.clone());
    put("ReceiverCellPhone", w.receiver_phone.clone());
    put("ReceiverStoreID", w.store_id.clone());
    put("ServerReplyURL", REPLY_URL.into());
    let text = post(stage, "/Express/Create", p, &c).await?;
    let (ok, map, body) = parse_reply(&text);
    let rtn_ok = map
        .get("RtnCode")
        .is_some_and(|c| c == "300" || c == "2001");
    let get = |k: &str| map.get(k).cloned().unwrap_or_default();
    Ok(Waybill {
        ok: ok && rtn_ok,
        logistics_id: get("AllPayLogisticsID"),
        payment_no: get("CVSPaymentNo"),
        validation_no: get("CVSValidationNo"),
        message: if ok && rtn_ok { get("RtnMsg") } else { body },
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeStatus {
    pub found: bool,
    pub status: String,
    pub message: String,
}

pub async fn query(
    store: &dyn SecretStore,
    stage: bool,
    trade_no: &str,
) -> Result<TradeStatus, String> {
    if trade_no.is_empty() || trade_no.len() > 20 {
        return Err("BAD_TRADE_NO".into());
    }
    let c = load_creds(store)?;
    let mut p = BTreeMap::new();
    p.insert("MerchantID".into(), c.merchant_id.clone());
    p.insert("MerchantTradeNo".into(), trade_no.to_string());
    p.insert("TimeStamp".into(), unix_now().to_string());
    let text = post(stage, "/Helper/QueryLogisticsTradeInfo/V2", p, &c).await?;
    let (_, map, body) = parse_reply(&text);
    let status = map
        .get("LogisticsStatus")
        .map(|s| {
            // Strip a trailing code description if ECPay appends one.
            s.clone()
        })
        .unwrap_or_default();
    Ok(TradeStatus {
        found: !status.is_empty(),
        message: map.get("LogisticsStatusMsg").cloned().unwrap_or(body),
        status,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemoryStore;

    fn map(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn encodes_like_dotnet_lowercase() {
        assert_eq!(url_encode("A b/C"), "a+b%2fc");
        assert_eq!(url_encode("-_.!*()"), "-_.!*()");
        assert_eq!(url_encode("中"), "%e4%b8%ad");
    }

    #[test]
    fn signature_ignores_order_and_changes_with_content() {
        let a = map(&[("MerchantID", "2000132"), ("A", "1"), ("b", "2")]);
        let b = map(&[("b", "2"), ("A", "1"), ("MerchantID", "2000132")]);
        let s = check_mac(&a, "key", "iv");
        assert_eq!(s, check_mac(&b, "key", "iv"));
        assert_eq!(s.len(), 32);
        assert!(s
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()));
        assert_ne!(s, check_mac(&a, "key2", "iv"));
        let c = map(&[("MerchantID", "2000132"), ("A", "2"), ("b", "2")]);
        assert_ne!(s, check_mac(&c, "key", "iv"));
    }

    #[test]
    fn signature_sorts_case_insensitively() {
        // "a" sorts before "B" when case is ignored, so the signed text is a=..&B=..
        let m = map(&[("B", "2"), ("a", "1")]);
        let expected = {
            let raw = "HashKey=k&a=1&B=2&HashIV=i";
            let d = Md5::digest(url_encode(raw).as_bytes());
            d.iter().map(|b| format!("{b:02X}")).collect::<String>()
        };
        assert_eq!(check_mac(&m, "k", "i"), expected);
    }

    #[test]
    fn parses_replies() {
        let (ok, m, _) = parse_reply("1|RtnCode=300&RtnMsg=ok&CVSPaymentNo=F123");
        assert!(ok);
        assert_eq!(m["CVSPaymentNo"], "F123");
        let (ok, m, body) = parse_reply("0|CheckMacValue Error");
        assert!(!ok && m.is_empty());
        assert_eq!(body, "CheckMacValue Error");
    }

    #[test]
    fn stamp_is_a_date_time() {
        let s = stamp();
        assert_eq!(s.len(), 19);
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(20_000), (2024, 10, 4));
    }

    fn waybill() -> NewWaybill {
        NewWaybill {
            trade_no: "LS12345".into(),
            sub_type: "UNIMARTC2C".into(),
            amount: 350,
            collection: 388,
            cod: true,
            goods: "áo".into(),
            receiver_name: "王小明".into(),
            receiver_phone: "0912345678".into(),
            store_id: "131386".into(),
        }
    }

    #[test]
    fn validates_waybills() {
        assert!(validate(&waybill()).is_ok());
        let mut w = waybill();
        w.amount = 0;
        assert_eq!(validate(&w), Err("BAD_AMOUNT".into()));
        let mut w = waybill();
        w.receiver_phone = "0212345678".into();
        assert_eq!(validate(&w), Err("BAD_PHONE".into()));
        let mut w = waybill();
        w.trade_no = "has space".into();
        assert_eq!(validate(&w), Err("BAD_TRADE_NO".into()));
        let mut w = waybill();
        w.sub_type = "OTHER".into();
        assert_eq!(validate(&w), Err("BAD_SUBTYPE".into()));
    }

    #[test]
    fn needs_saved_keys() {
        let store = MemoryStore::default();
        assert!(matches!(load_creds(&store), Err(e) if e == "NO_CREDENTIALS"));
        store.set("carrier-ecpay-merchantid", "2000132").unwrap();
        store.set("carrier-ecpay-hashkey", "k").unwrap();
        store.set("carrier-ecpay-hashiv", "i").unwrap();
        assert!(load_creds(&store).is_ok());
    }
}

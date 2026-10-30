//! Shipping orders (7-ELEVEN pickup, "đơn ship") and the saved-customer list.
//!
//! Rules: recipient name / phone / store are typed by the seller (or copied from what the buyer
//! sent) and are never generated. A buyer's TikTok ID is remembered when the seller confirms a
//! live order, so the shipping form can be filled from that list later. Nothing here talks to a
//! carrier; export for the carrier is a separate, explicit step.

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};

// Limits follow the official 7-ELEVEN order-import sheet (賣貨便 v1.5, resources/ folder),
// except the COD minimum, which uses the stricter 58 that taodonnhanh.com also enforces.
pub const MIN_TOTAL: i64 = 58; // order amount + shipping fee (COD minimum)
pub const MAX_TOTAL: i64 = 20_000;
pub const DEFAULT_FEE: i64 = 38;
pub const MAX_AMOUNT: i64 = 20_000;
pub const MAX_FEE: i64 = 100;
pub const MAX_ROWS: usize = 500;
const TEMPLATE: &[u8] = include_bytes!("../resources/seven-eleven-order-import-v1.5.xlsx");
pub const TEMPERATURES: &[&str] = &["NORMAL", "FROZEN"];

fn bad(msg: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(msg.to_string())
}

/// TikTok IDs: ASCII letters, digits, `.` and `_`, without a leading `@`, lowercase.
pub fn clean_tiktok_id(raw: &str) -> Option<String> {
    let id = raw.trim().trim_start_matches('@').to_lowercase();
    if id.is_empty()
        || id.chars().count() > 24
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_')
    {
        return None;
    }
    Some(id)
}

/// Taiwan mobile number: 09 + 8 digits (spaces and dashes are ignored).
pub fn clean_phone(raw: &str) -> Option<String> {
    let digits: String = raw.chars().filter(|c| !" -".contains(*c)).collect();
    (digits.len() == 10 && digits.starts_with("09") && digits.chars().all(|c| c.is_ascii_digit()))
        .then_some(digits)
}

/// 7-ELEVEN store number: exactly 6 digits.
pub fn clean_store_code(raw: &str) -> Option<String> {
    let code = raw.trim();
    (code.len() == 6 && code.chars().all(|c| c.is_ascii_digit())).then(|| code.to_string())
}

/// Recipient name: 2 to 10 characters, no digits or the symbols the import sheet forbids.
pub fn clean_recipient(raw: &str) -> Option<String> {
    let n = text(raw, 10)?;
    const FORBIDDEN: &str = "`~!@#$%^&*()/\\|,.<>'?\"();:_+-=[]{}";
    (n.chars().count() >= 2
        && !n
            .chars()
            .any(|c| c.is_ascii_digit() || FORBIDDEN.contains(c)))
    .then_some(n)
}

fn text(raw: &str, max: usize) -> Option<String> {
    let t: String = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    (!t.is_empty() && t.chars().count() <= max && !t.chars().any(|c| c.is_control())).then_some(t)
}

// ---------- stores (importable list, looked up by store number) ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoreDto {
    pub code: String,
    pub name: String,
    #[serde(default)]
    pub address: String,
}

/// Import stores from text, one per line: `code,name,address` (comma, tab or `;`).
/// Lines that do not parse are skipped; returns (imported, skipped).
pub fn stores_import(conn: &mut Connection, body: &str) -> Result<(usize, usize)> {
    let tx = conn.transaction()?;
    let (mut ok, mut skipped) = (0, 0);
    for line in body.trim_start_matches('\u{feff}').lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.splitn(3, |c| c == ',' || c == '\t' || c == ';');
        let code = parts
            .next()
            .and_then(|c| clean_store_code(c.trim_matches('"')));
        let name = parts.next().and_then(|n| text(n.trim_matches('"'), 60));
        let address = parts
            .next()
            .and_then(|a| text(a.trim_matches('"'), 120))
            .unwrap_or_default();
        match (code, name) {
            (Some(code), Some(name)) => {
                tx.execute(
                    "INSERT INTO ship_stores (code, name, address) VALUES (?1, ?2, ?3)
                     ON CONFLICT(code) DO UPDATE SET name = ?2, address = ?3",
                    params![code, name, address],
                )?;
                ok += 1;
            }
            _ => skipped += 1,
        }
    }
    tx.commit()?;
    Ok((ok, skipped))
}

pub fn store_lookup(conn: &Connection, code: &str) -> Result<Option<StoreDto>> {
    let Some(code) = clean_store_code(code) else {
        return Ok(None);
    };
    conn.query_row(
        "SELECT code, name, address FROM ship_stores WHERE code = ?1",
        [code],
        |r| {
            Ok(StoreDto {
                code: r.get(0)?,
                name: r.get(1)?,
                address: r.get(2)?,
            })
        },
    )
    .optional()
}

pub fn stores_count(conn: &Connection) -> Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM ship_stores", [], |r| r.get(0))
}

// ---------- online store search (7-ELEVEN's own public map page) ----------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoreHit {
    pub code: String,
    pub name: String,
    pub address: String,
    /// The map lists the store but it cannot take pickup parcels right now.
    pub disabled: bool,
}

/// One result per line: `name,store number,address,enable|disable,type`. Only real stores
/// (type 門市) with a valid 6-digit number are kept; `NO1`/`NO2`/`NO3` mean no usable match.
pub fn parse_store_lines(body: &str) -> Vec<StoreHit> {
    body.lines()
        .filter_map(|line| {
            let p: Vec<&str> = line.trim().split(',').collect();
            if p.len() < 5 || p[4].trim() != "門市" {
                return None;
            }
            Some(StoreHit {
                code: clean_store_code(p[1])?,
                name: text(p[0], 60)?,
                address: text(p[2], 120).unwrap_or_default(),
                disabled: p[3].trim() == "disable",
            })
        })
        .collect()
}

/// A search text: a store number, a store name or part of an address.
pub fn clean_search(raw: &str) -> Option<String> {
    text(raw, 30)
}

pub const SEARCH_URL: &str = "https://emap.pcsc.com.tw/mobilemap/Id/Data.aspx";
pub const MAX_HITS: usize = 20;

/// Keep hits that can receive parcels, so a later offline lookup by number works.
pub fn stores_cache(conn: &Connection, hits: &[StoreHit]) -> Result<()> {
    for h in hits.iter().filter(|h| !h.disabled) {
        conn.execute(
            "INSERT INTO ship_stores (code, name, address) VALUES (?1, ?2, ?3)
             ON CONFLICT(code) DO UPDATE SET name = ?2, address = ?3",
            params![h.code, h.name, h.address],
        )?;
    }
    Ok(())
}

// ---------- customers ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CustomerDto {
    pub tiktok_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub store_code: String,
    #[serde(default)]
    pub store_name: String,
    #[serde(default)]
    pub updated_at: String,
}

/// Called when the seller confirms a live order: remember the buyer's TikTok ID so the shipping
/// form can be completed later. Only the ID is stored; name/phone/store stay empty until typed.
pub fn remember_buyer(conn: &Connection, tiktok_id: &str, now: &str) -> Result<()> {
    let Some(id) = clean_tiktok_id(tiktok_id) else {
        return Ok(());
    };
    conn.execute(
        "INSERT INTO ship_customers (tiktok_id, created_at, updated_at) VALUES (?1, ?2, ?2)
         ON CONFLICT(tiktok_id) DO UPDATE SET updated_at = ?2",
        params![id, now],
    )?;
    Ok(())
}

/// Seller-entered details. Empty fields stay empty; filled ones must be valid.
pub fn customer_save(conn: &Connection, c: &CustomerDto, now: &str) -> Result<CustomerDto> {
    let id = clean_tiktok_id(&c.tiktok_id).ok_or_else(|| bad("tiktok_id"))?;
    let name = if c.name.trim().is_empty() {
        String::new()
    } else {
        clean_recipient(&c.name).ok_or_else(|| bad("name"))?
    };
    let phone = if c.phone.trim().is_empty() {
        String::new()
    } else {
        clean_phone(&c.phone).ok_or_else(|| bad("phone"))?
    };
    let (code, store_name) = if c.store_code.trim().is_empty() {
        (String::new(), String::new())
    } else {
        (
            clean_store_code(&c.store_code).ok_or_else(|| bad("store_code"))?,
            if c.store_name.trim().is_empty() {
                String::new()
            } else {
                text(&c.store_name, 60).ok_or_else(|| bad("store_name"))?
            },
        )
    };
    conn.execute(
        "INSERT INTO ship_customers
            (tiktok_id, name, phone, store_code, store_name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(tiktok_id) DO UPDATE SET
            name = ?2, phone = ?3, store_code = ?4, store_name = ?5, updated_at = ?6",
        params![id, name, phone, code, store_name, now],
    )?;
    Ok(CustomerDto {
        tiktok_id: id,
        name,
        phone,
        store_code: code,
        store_name,
        updated_at: now.to_string(),
    })
}

pub fn customer_list(conn: &Connection) -> Result<Vec<CustomerDto>> {
    let mut stmt = conn.prepare(
        "SELECT tiktok_id, name, phone, store_code, store_name, updated_at
         FROM ship_customers ORDER BY updated_at DESC, tiktok_id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(CustomerDto {
            tiktok_id: r.get(0)?,
            name: r.get(1)?,
            phone: r.get(2)?,
            store_code: r.get(3)?,
            store_name: r.get(4)?,
            updated_at: r.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn customer_delete(conn: &Connection, tiktok_id: &str) -> Result<usize> {
    conn.execute(
        "DELETE FROM ship_customers WHERE tiktok_id = ?1",
        [tiktok_id],
    )
}

// ---------- shipping orders ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShipOrderDto {
    pub id: String,
    #[serde(default)]
    pub tiktok_id: String,
    pub recipient_name: String,
    pub phone: String,
    pub temperature: String,
    pub store_code: String,
    #[serde(default)]
    pub store_name: String,
    pub product: String,
    #[serde(default)]
    pub note: String,
    pub amount: i64,
    pub shipping_fee: i64,
    /// Computed: amount + shipping fee. Ignored on input.
    #[serde(default)]
    pub cod: i64,
    #[serde(default)]
    pub exported: bool,
    #[serde(default)]
    pub created_at: String,
}

/// Validate and store (insert or update) one shipping order. Returns the stored form.
pub fn order_save(
    conn: &Connection,
    o: &ShipOrderDto,
    remember: bool,
    now: &str,
) -> Result<ShipOrderDto> {
    if o.id.is_empty() || o.id.len() > 64 {
        return Err(bad("id"));
    }
    let tiktok = if o.tiktok_id.trim().is_empty() {
        String::new()
    } else {
        clean_tiktok_id(&o.tiktok_id).ok_or_else(|| bad("tiktok_id"))?
    };
    let name = clean_recipient(&o.recipient_name).ok_or_else(|| bad("name"))?;
    let phone = clean_phone(&o.phone).ok_or_else(|| bad("phone"))?;
    if !TEMPERATURES.contains(&o.temperature.as_str()) {
        return Err(bad("temperature"));
    }
    let code = clean_store_code(&o.store_code).ok_or_else(|| bad("store_code"))?;
    let store_name = if o.store_name.trim().is_empty() {
        // Fall back to the imported list, if the store is known there.
        store_lookup(conn, &code)?
            .map(|s| s.name)
            .unwrap_or_default()
    } else {
        text(&o.store_name, 60).ok_or_else(|| bad("store_name"))?
    };
    let product = text(&o.product, 200).ok_or_else(|| bad("product"))?;
    let note = if o.note.trim().is_empty() {
        String::new()
    } else {
        text(&o.note, 200).ok_or_else(|| bad("note"))?
    };
    if !(0..=MAX_AMOUNT).contains(&o.amount) {
        return Err(bad("amount"));
    }
    if !(0..=MAX_FEE).contains(&o.shipping_fee) {
        return Err(bad("shipping_fee"));
    }
    let cod = o.amount + o.shipping_fee;
    if !(MIN_TOTAL..=MAX_TOTAL).contains(&cod) {
        return Err(bad("cod_min"));
    }
    conn.execute(
        "INSERT INTO ship_orders
            (id, tiktok_id, recipient_name, phone, temperature, store_code, store_name,
             product, note, amount, shipping_fee, cod, exported, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,0,?13,?13)
         ON CONFLICT(id) DO UPDATE SET
            tiktok_id=?2, recipient_name=?3, phone=?4, temperature=?5, store_code=?6,
            store_name=?7, product=?8, note=?9, amount=?10, shipping_fee=?11, cod=?12,
            updated_at=?13",
        params![
            o.id,
            tiktok,
            name,
            phone,
            o.temperature,
            code,
            store_name,
            product,
            note,
            o.amount,
            o.shipping_fee,
            cod,
            now
        ],
    )?;
    if remember && !tiktok.is_empty() {
        customer_save(
            conn,
            &CustomerDto {
                tiktok_id: tiktok.clone(),
                name: name.clone(),
                phone: phone.clone(),
                store_code: code.clone(),
                store_name: store_name.clone(),
                updated_at: String::new(),
            },
            now,
        )?;
    }
    order_get(conn, &o.id)?.ok_or_else(|| bad("missing"))
}

fn map_order(r: &rusqlite::Row<'_>) -> Result<ShipOrderDto> {
    Ok(ShipOrderDto {
        id: r.get(0)?,
        tiktok_id: r.get(1)?,
        recipient_name: r.get(2)?,
        phone: r.get(3)?,
        temperature: r.get(4)?,
        store_code: r.get(5)?,
        store_name: r.get(6)?,
        product: r.get(7)?,
        note: r.get(8)?,
        amount: r.get(9)?,
        shipping_fee: r.get(10)?,
        cod: r.get(11)?,
        exported: r.get::<_, i64>(12)? != 0,
        created_at: r.get(13)?,
    })
}

const ORDER_COLS: &str = "id, tiktok_id, recipient_name, phone, temperature, store_code, \
    store_name, product, note, amount, shipping_fee, cod, exported, created_at";

pub fn order_get(conn: &Connection, id: &str) -> Result<Option<ShipOrderDto>> {
    conn.query_row(
        &format!("SELECT {ORDER_COLS} FROM ship_orders WHERE id = ?1"),
        [id],
        map_order,
    )
    .optional()
}

pub fn order_list(conn: &Connection) -> Result<Vec<ShipOrderDto>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {ORDER_COLS} FROM ship_orders ORDER BY created_at DESC, rowid DESC"
    ))?;
    let rows = stmt.query_map([], map_order)?;
    rows.collect()
}

pub fn order_set_exported(conn: &Connection, ids: &[String], exported: bool) -> Result<usize> {
    let mut n = 0;
    for id in ids {
        n += conn.execute(
            "UPDATE ship_orders SET exported = ?2 WHERE id = ?1",
            params![id, exported as i64],
        )?;
    }
    Ok(n)
}

pub fn order_delete(conn: &Connection, id: &str) -> Result<usize> {
    conn.execute("DELETE FROM ship_orders WHERE id = ?1", [id])
}

// ---------- buyer flow (which steps of the A-Z routine are done for a buyer) ----------

pub const FLOW_STEPS: &[&str] = &["SLIP_PRINTED", "ASK_COPIED"];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FlowDto {
    pub tiktok_id: String,
    pub slip_printed_at: Option<String>,
    pub ask_copied_at: Option<String>,
}

/// Record that a step was done for a buyer (only timestamps; the first time is kept).
pub fn flow_mark(conn: &Connection, tiktok_id: &str, step: &str, now: &str) -> Result<()> {
    let id = clean_tiktok_id(tiktok_id).ok_or_else(|| bad("tiktok_id"))?;
    let col = match step {
        "SLIP_PRINTED" => "slip_printed_at",
        "ASK_COPIED" => "ask_copied_at",
        _ => return Err(bad("step")),
    };
    conn.execute(
        &format!(
            "INSERT INTO buyer_flow (tiktok_id, {col}, created_at, updated_at) VALUES (?1, ?2, ?2, ?2)
             ON CONFLICT(tiktok_id) DO UPDATE SET {col} = COALESCE({col}, ?2), updated_at = ?2"
        ),
        params![id, now],
    )?;
    Ok(())
}

pub fn flow_list(conn: &Connection) -> Result<Vec<FlowDto>> {
    let mut stmt =
        conn.prepare("SELECT tiktok_id, slip_printed_at, ask_copied_at FROM buyer_flow")?;
    let rows = stmt.query_map([], |r| {
        Ok(FlowDto {
            tiktok_id: r.get(0)?,
            slip_printed_at: r.get(1)?,
            ask_copied_at: r.get(2)?,
        })
    })?;
    rows.collect()
}

// ---------- Excel export (賣貨便 order import, template v1.5) ----------

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn cell(col: char, row: usize, value: &str) -> String {
    // Text cells (style 1 is the template's text format), so a phone keeps its leading 0.
    format!(
        "<c r=\"{col}{row}\" s=\"1\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>",
        xml_escape(value)
    )
}

/// The template's own file with the order rows written from row 7. The second sheet (with the
/// template version) is untouched, as the sheet asks. Cells are text, as the sheet asks.
pub fn export_xlsx(orders: &[ShipOrderDto]) -> std::result::Result<Vec<u8>, String> {
    use std::io::{Cursor, Read, Write};
    if orders.is_empty() {
        return Err("EMPTY".into());
    }
    if orders.len() > MAX_ROWS {
        return Err("TOO_MANY".into());
    }
    let mut rows = String::new();
    for (i, o) in orders.iter().enumerate() {
        let r = 7 + i;
        let temp = if o.temperature == "FROZEN" {
            "冷凍"
        } else {
            "常溫"
        };
        let date: String = o.created_at.chars().take(10).collect();
        let other = if o.tiktok_id.is_empty() {
            String::new()
        } else {
            format!("@{}", o.tiktok_id)
        };
        rows.push_str(&format!("<row r=\"{r}\">"));
        for (col, v) in [
            ('A', o.recipient_name.as_str()),
            ('B', o.phone.as_str()),
            ('C', o.store_code.as_str()),
            ('D', temp),
            ('E', o.product.as_str()),
            ('F', &o.amount.to_string()),
            ('G', &o.shipping_fee.to_string()),
            ('H', date.as_str()),
            ('I', o.note.as_str()),
            ('J', other.as_str()),
        ] {
            if !v.is_empty() {
                rows.push_str(&cell(col, r, v));
            }
        }
        rows.push_str("</row>");
    }

    let mut zin = zip::ZipArchive::new(Cursor::new(TEMPLATE)).map_err(|e| e.to_string())?;
    let mut out = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for i in 0..zin.len() {
        let mut f = zin.by_index(i).map_err(|e| e.to_string())?;
        let name = f.name().to_string();
        let mut data = Vec::new();
        f.read_to_end(&mut data).map_err(|e| e.to_string())?;
        if name == "xl/worksheets/sheet1.xml" {
            let xml = String::from_utf8(data).map_err(|e| e.to_string())?;
            let start = xml.find("<row r=\"7\"").ok_or("TEMPLATE")?;
            let end = xml.find("</sheetData>").ok_or("TEMPLATE")?;
            let last = 6 + orders.len();
            let patched = format!("{}{}{}", &xml[..start], rows, &xml[end..]).replace(
                "<dimension ref=\"A1:K7\"/>",
                &format!("<dimension ref=\"A1:K{last}\"/>"),
            );
            data = patched.into_bytes();
        }
        out.start_file(name, opts).map_err(|e| e.to_string())?;
        out.write_all(&data).map_err(|e| e.to_string())?;
    }
    Ok(out.finish().map_err(|e| e.to_string())?.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn sample(id: &str) -> ShipOrderDto {
        ShipOrderDto {
            id: id.into(),
            tiktok_id: "@Mai_Tran".into(),
            recipient_name: "Trần Mai".into(),
            phone: "0912-345 678".into(),
            temperature: "NORMAL".into(),
            store_code: "131386".into(),
            store_name: String::new(),
            product: "Áo thun trắng".into(),
            note: String::new(),
            amount: 300,
            shipping_fee: 38,
            cod: 0,
            exported: false,
            created_at: String::new(),
        }
    }

    #[test]
    fn validators() {
        assert_eq!(clean_phone("0912 345-678").as_deref(), Some("0912345678"));
        assert!(clean_phone("0212345678").is_none());
        assert!(clean_phone("091234567").is_none());
        assert_eq!(clean_store_code(" 131386 ").as_deref(), Some("131386"));
        assert!(clean_store_code("12a456").is_none());
        assert!(clean_store_code("1234").is_none());
        assert!(clean_store_code("1234567").is_none());
        assert_eq!(clean_tiktok_id("@Mai_Tran").as_deref(), Some("mai_tran"));
        assert!(clean_tiktok_id("mai tran").is_none());
    }

    #[test]
    fn save_computes_cod_and_remembers_customer() {
        let c = open_in_memory().unwrap();
        let o = order_save(&c, &sample("o1"), true, "2026-01-01T00:00:00Z").unwrap();
        assert_eq!(o.cod, 338);
        assert_eq!(o.phone, "0912345678");
        assert_eq!(o.tiktok_id, "mai_tran");
        assert!(!o.exported);
        let cs = customer_list(&c).unwrap();
        assert_eq!(cs.len(), 1);
        assert_eq!(cs[0].store_code, "131386");
    }

    #[test]
    fn rejects_bad_input_and_low_total() {
        let c = open_in_memory().unwrap();
        let mut o = sample("o1");
        o.amount = 10; // 10 + 38 < 58
        assert!(order_save(&c, &o, false, "t").is_err());
        let mut o = sample("o2");
        o.phone = "123".into();
        assert!(order_save(&c, &o, false, "t").is_err());
        let mut o = sample("o3");
        o.temperature = "HOT".into();
        assert!(order_save(&c, &o, false, "t").is_err());
        let mut o = sample("o4");
        o.recipient_name = "  ".into();
        assert!(order_save(&c, &o, false, "t").is_err());
        assert!(order_list(&c).unwrap().is_empty());
    }

    #[test]
    fn recipient_rules_follow_the_import_sheet() {
        assert!(clean_recipient("Mai").is_some());
        assert!(clean_recipient("A").is_none()); // min 2
        assert!(clean_recipient("Nguyễn Văn Anh").is_none()); // max 10
        assert!(clean_recipient("Mai2").is_none()); // digits
        assert!(clean_recipient("Mai_T").is_none()); // symbol
        assert!(clean_recipient("陳小明").is_some());
    }

    #[test]
    fn limits_follow_the_import_sheet() {
        let c = open_in_memory().unwrap();
        let mut o = sample("o1");
        o.shipping_fee = 101;
        assert!(order_save(&c, &o, false, "t").is_err());
        let mut o = sample("o2");
        o.amount = 20_000;
        o.shipping_fee = 38; // total > 20000
        assert!(order_save(&c, &o, false, "t").is_err());
        let mut o = sample("o3");
        o.amount = 19_962;
        assert!(order_save(&c, &o, false, "t").is_ok());
    }

    #[test]
    fn xlsx_export_fills_the_template_rows() {
        use std::io::Read;
        let c = open_in_memory().unwrap();
        let mut o1 = order_save(&c, &sample("o1"), false, "2026-10-30T01:00:00Z").unwrap();
        o1.product = "A & <B>".into();
        o1.temperature = "FROZEN".into();
        let o2 = order_save(&c, &sample("o2"), false, "2026-10-30T02:00:00Z").unwrap();
        let bytes = export_xlsx(&[o1, o2]).unwrap();
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let mut xml = String::new();
        z.by_name("xl/worksheets/sheet1.xml")
            .unwrap()
            .read_to_string(&mut xml)
            .unwrap();
        assert!(xml.contains("<dimension ref=\"A1:K8\"/>"));
        assert!(xml.contains(">0912345678</t>")); // leading zero kept (text cell)
        assert!(xml.contains(">冷凍</t>") && xml.contains(">常溫</t>"));
        assert!(xml.contains(">A &amp; &lt;B&gt;</t>"));
        assert!(xml.contains(">2026-10-30</t>") && xml.contains(">@mai_tran</t>"));
        assert!(!xml.contains(">ABC</t>")); // the template's sample row is gone
        assert!(z.by_name("xl/worksheets/sheet2.xml").is_ok());
        assert!(export_xlsx(&[]).is_err());
    }

    #[test]
    fn parses_store_search_lines() {
        let hits = parse_store_lines(
            "建盛,131386,新竹市東區建中一路52號1樓,enable,門市\n\
             某店,222222,台北市,disable,門市\n\
             櫃,333333,x,enable,智取店\n\
             壞,12,x,enable,門市\n",
        );
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].code, "131386");
        assert_eq!(hits[0].name, "建盛");
        assert!(!hits[0].disabled && hits[1].disabled);
        assert!(parse_store_lines("NO1").is_empty());
        assert_eq!(clean_search("  建盛  ").as_deref(), Some("建盛"));
        assert!(clean_search("  ").is_none());
    }

    #[test]
    fn cache_keeps_only_usable_stores() {
        let c = open_in_memory().unwrap();
        let hits = parse_store_lines("a,111111,addr,enable,門市\nb,222222,addr,disable,門市");
        stores_cache(&c, &hits).unwrap();
        assert!(store_lookup(&c, "111111").unwrap().is_some());
        assert!(store_lookup(&c, "222222").unwrap().is_none());
    }

    #[test]
    fn flow_marks_keep_the_first_time() {
        let c = open_in_memory().unwrap();
        flow_mark(&c, "@Mai", "SLIP_PRINTED", "t1").unwrap();
        flow_mark(&c, "mai", "SLIP_PRINTED", "t2").unwrap();
        flow_mark(&c, "mai", "ASK_COPIED", "t3").unwrap();
        assert!(flow_mark(&c, "mai", "NOPE", "t").is_err());
        assert!(flow_mark(&c, "bad id", "ASK_COPIED", "t").is_err());
        let f = flow_list(&c).unwrap();
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].slip_printed_at.as_deref(), Some("t1"));
        assert_eq!(f[0].ask_copied_at.as_deref(), Some("t3"));
    }

    #[test]
    fn exact_minimum_total_is_allowed() {
        let c = open_in_memory().unwrap();
        let mut o = sample("o1");
        o.amount = 20;
        assert_eq!(order_save(&c, &o, false, "t").unwrap().cod, 58);
    }

    #[test]
    fn update_keeps_exported_flag_and_export_toggles() {
        let c = open_in_memory().unwrap();
        order_save(&c, &sample("o1"), false, "t1").unwrap();
        assert_eq!(
            order_set_exported(&c, &["o1".into(), "zz".into()], true).unwrap(),
            1
        );
        let mut o = sample("o1");
        o.amount = 500;
        let saved = order_save(&c, &o, false, "t2").unwrap();
        assert!(saved.exported);
        assert_eq!(saved.cod, 538);
        assert_eq!(order_delete(&c, "o1").unwrap(), 1);
    }

    #[test]
    fn stores_import_lookup_and_autofill() {
        let mut c = open_in_memory().unwrap();
        let (ok, skipped) = stores_import(
            &mut c,
            "code,name,address\n131386,Trung Hiếu,Taipei\n\"999999\";\"Shop B\";Taichung\nbad line\n",
        )
        .unwrap();
        assert_eq!((ok, skipped), (2, 2)); // header + "bad line" skipped
        assert_eq!(stores_count(&c).unwrap(), 2);
        assert_eq!(
            store_lookup(&c, "131386").unwrap().unwrap().name,
            "Trung Hiếu"
        );
        assert!(store_lookup(&c, "000000").unwrap().is_none());
        let o = order_save(&c, &sample("o1"), false, "t").unwrap();
        assert_eq!(o.store_name, "Trung Hiếu");
    }

    #[test]
    fn remember_buyer_stores_only_the_id() {
        let c = open_in_memory().unwrap();
        remember_buyer(&c, "@Lan.Pham", "t1").unwrap();
        remember_buyer(&c, "lan.pham", "t2").unwrap();
        remember_buyer(&c, "not valid!", "t3").unwrap();
        let cs = customer_list(&c).unwrap();
        assert_eq!(cs.len(), 1);
        assert_eq!(cs[0].tiktok_id, "lan.pham");
        assert!(cs[0].name.is_empty() && cs[0].phone.is_empty());
    }

    #[test]
    fn customer_save_validates_filled_fields_only() {
        let c = open_in_memory().unwrap();
        let mut cu = CustomerDto {
            tiktok_id: "a".into(),
            name: String::new(),
            phone: "bad".into(),
            store_code: String::new(),
            store_name: String::new(),
            updated_at: String::new(),
        };
        assert!(customer_save(&c, &cu, "t").is_err());
        cu.phone = String::new();
        assert!(customer_save(&c, &cu, "t").is_ok());
        assert_eq!(customer_delete(&c, "a").unwrap(), 1);
    }
}

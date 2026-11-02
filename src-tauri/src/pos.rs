//! In-person checkout ("Tính tiền" tab): the seller scans units out exactly like the existing
//! warehouse "Xuất kho" flow (same `wh::ship`, so the sale's revenue is already picked up by the
//! dashboard's `unitSales()` merge with no extra wiring). This module only stores what that flow
//! does not: how the sale was paid, and an internal sequential receipt number when the seller
//! turned that on in Settings. It is a record for the seller's own till history, never a
//! Taiwanese government e-invoice (統一發票) — no number here is issued by, or reported to, the
//! tax authority.

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};

pub const PAYMENT_METHODS: &[&str] = &["CASH", "TRANSFER", "OTHER"];
pub const MAX_ROWS: i64 = 500;

fn bad(msg: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(msg.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PosSaleDto {
    pub id: String,
    pub created_at: String,
    pub total: i64,
    pub payment_method: String,
    #[serde(default)]
    pub receipt_no: String,
    #[serde(default)]
    pub note: String,
}

fn text(raw: &str, max: usize) -> Option<String> {
    let t: String = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    (t.chars().count() <= max && !t.chars().any(|c| c.is_control())).then_some(t)
}

fn map(r: &rusqlite::Row<'_>) -> rusqlite::Result<PosSaleDto> {
    Ok(PosSaleDto {
        id: r.get(0)?,
        created_at: r.get(1)?,
        total: r.get(2)?,
        payment_method: r.get(3)?,
        receipt_no: r.get(4)?,
        note: r.get(5)?,
    })
}

const COLS: &str = "id, created_at, total, payment_method, receipt_no, note";

/// Store one sale's metadata. The units themselves are shipped separately through `wh::ship`,
/// with this same id as the order id; this call only has to happen after that succeeds.
pub fn sale_save(conn: &Connection, s: &PosSaleDto, now: &str) -> Result<()> {
    if s.id.is_empty() || s.id.len() > 64 {
        return Err(bad("id"));
    }
    if s.total < 0 {
        return Err(bad("total"));
    }
    if !PAYMENT_METHODS.contains(&s.payment_method.as_str()) {
        return Err(bad("payment_method"));
    }
    let receipt_no = text(&s.receipt_no, 40).ok_or_else(|| bad("receipt_no"))?;
    let note = text(&s.note, 120).ok_or_else(|| bad("note"))?;
    conn.execute(
        "INSERT INTO pos_sales (id, created_at, total, payment_method, receipt_no, note)
         VALUES (?1,?2,?3,?4,?5,?6)
         ON CONFLICT(id) DO UPDATE SET
            total=excluded.total, payment_method=excluded.payment_method,
            receipt_no=excluded.receipt_no, note=excluded.note",
        params![s.id, now, s.total, s.payment_method, receipt_no, note],
    )?;
    Ok(())
}

/// Most recent sales first, for a short till history. `limit` is capped at `MAX_ROWS`.
pub fn sales_list(conn: &Connection, limit: i64) -> Result<Vec<PosSaleDto>> {
    let limit = limit.clamp(1, MAX_ROWS);
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM pos_sales ORDER BY created_at DESC LIMIT ?1"
    ))?;
    let rows = stmt.query_map([limit], map)?;
    rows.collect()
}

#[allow(dead_code)]
pub fn sale_get(conn: &Connection, id: &str) -> Result<Option<PosSaleDto>> {
    conn.query_row(
        &format!("SELECT {COLS} FROM pos_sales WHERE id = ?1"),
        [id],
        map,
    )
    .optional()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn dto(id: &str) -> PosSaleDto {
        PosSaleDto {
            id: id.into(),
            created_at: String::new(),
            total: 100,
            payment_method: "CASH".into(),
            receipt_no: String::new(),
            note: String::new(),
        }
    }

    #[test]
    fn saves_and_lists() {
        let conn = open_in_memory().unwrap();
        sale_save(&conn, &dto("pos-1"), "2026-01-01T00:00:00Z").unwrap();
        sale_save(&conn, &dto("pos-2"), "2026-01-02T00:00:00Z").unwrap();
        let rows = sales_list(&conn, 10).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, "pos-2"); // most recent first
    }

    #[test]
    fn rejects_bad_payment_method() {
        let conn = open_in_memory().unwrap();
        let mut s = dto("pos-1");
        s.payment_method = "BITCOIN".into();
        assert!(sale_save(&conn, &s, "2026-01-01T00:00:00Z").is_err());
    }

    #[test]
    fn upserts_on_same_id() {
        let conn = open_in_memory().unwrap();
        sale_save(&conn, &dto("pos-1"), "2026-01-01T00:00:00Z").unwrap();
        let mut s = dto("pos-1");
        s.total = 999;
        sale_save(&conn, &s, "2026-01-01T00:00:00Z").unwrap();
        let got = sale_get(&conn, "pos-1").unwrap().unwrap();
        assert_eq!(got.total, 999);
    }
}

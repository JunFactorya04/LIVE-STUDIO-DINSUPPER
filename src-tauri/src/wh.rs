//! Warehouse with a barcode on every unit. Receiving stock creates one code per unit (with the
//! selling price and cost on its label); scanning a code out marks that unit shipped and takes it
//! off the stock count; a stocktake compares what was scanned with what the books say is on the
//! shelf. Every change is also written to a movement log. Whole NT$, all on this computer.
//!
//! Codes are `<SKU>-<6-digit serial>` and use only characters a Code 128 label can carry.

use crate::biz;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const MAX_BATCH: i64 = 500;
const MAX_PRICE: i64 = 10_000_000;

pub type Res<T> = Result<T, String>;

fn db(e: rusqlite::Error) -> String {
    e.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnitDto {
    pub code: String,
    pub sku: String,
    pub price: i64,
    pub cost: i64,
    pub location: String,
    /// IN_STOCK, SHIPPED or VOID (lost, damaged, missing at a count).
    pub status: String,
    pub received_at: String,
    pub shipped_at: String,
    pub order_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiveReq {
    /// Id of the purchase this creates in the books.
    pub purchase_id: String,
    pub sku: String,
    pub qty: i64,
    /// Selling price printed on each label.
    pub price: i64,
    pub unit_cost: i64,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub supplier: String,
    /// Day of the purchase, yyyy-mm-dd.
    pub at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShipResult {
    pub units: Vec<UnitDto>,
    /// Sum of the units' selling prices.
    pub total: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveDto {
    pub id: i64,
    pub at: String,
    /// IN, OUT, MOVE, VOID, RETURN.
    pub kind: String,
    pub code: String,
    pub sku: String,
    pub location: String,
    pub note: String,
}

/// A sku that can be written as a barcode.
pub fn valid_sku(s: &str) -> bool {
    (1..=30).contains(&s.len())
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// A scanned code relayed from a phone to the computer: printable, no spaces, short.
pub fn valid_scan_code(s: &str) -> bool {
    (1..=64).contains(&s.len()) && s.chars().all(|c| c.is_ascii_graphic())
}

pub fn valid_location(s: &str) -> bool {
    s.len() <= 16 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

const COLS: &str = "code, sku, price, cost, location, status, received_at, shipped_at, order_id";

fn map(r: &rusqlite::Row<'_>) -> rusqlite::Result<UnitDto> {
    Ok(UnitDto {
        code: r.get(0)?,
        sku: r.get(1)?,
        price: r.get(2)?,
        cost: r.get(3)?,
        location: r.get(4)?,
        status: r.get(5)?,
        received_at: r.get(6)?,
        shipped_at: r.get(7)?,
        order_id: r.get(8)?,
    })
}

fn log(conn: &Connection, now: &str, kind: &str, u: &UnitDto, note: &str) -> Res<()> {
    conn.execute(
        "INSERT INTO wh_moves (at, kind, code, sku, location, note) VALUES (?1,?2,?3,?4,?5,?6)",
        params![now, kind, u.code, u.sku, u.location, note],
    )
    .map_err(db)?;
    Ok(())
}

pub fn unit_get(conn: &Connection, code: &str) -> Res<Option<UnitDto>> {
    conn.query_row(
        &format!("SELECT {COLS} FROM wh_units WHERE code = ?1"),
        [code.trim()],
        map,
    )
    .optional()
    .map_err(db)
}

pub fn units_list(conn: &Connection, status: &str, limit: i64) -> Res<Vec<UnitDto>> {
    if !matches!(status, "IN_STOCK" | "SHIPPED" | "VOID") {
        return Err("BAD_STATUS".into());
    }
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {COLS} FROM wh_units WHERE status = ?1 ORDER BY sku, code LIMIT ?2"
        ))
        .map_err(db)?;
    let rows = stmt
        .query_map(params![status, limit.clamp(1, 20_000)], map)
        .map_err(db)?;
    rows.collect::<Result<_, _>>().map_err(db)
}

/// Book `qty` units in: the purchase goes into the books (stock up, average cost) and each unit
/// gets its own code. Returns the new units, ready to be printed.
pub fn receive(conn: &Connection, q: &ReceiveReq, now: &str) -> Res<Vec<UnitDto>> {
    if !valid_sku(&q.sku) {
        return Err("BAD_SKU".into());
    }
    if !(1..=MAX_BATCH).contains(&q.qty) {
        return Err("BAD_QTY".into());
    }
    if !(0..=MAX_PRICE).contains(&q.price) || !(0..=MAX_PRICE).contains(&q.unit_cost) {
        return Err("BAD_PRICE".into());
    }
    if !valid_location(&q.location) {
        return Err("BAD_LOCATION".into());
    }
    let tx = conn.unchecked_transaction().map_err(db)?;
    biz::purchase_apply(
        &tx,
        &biz::PurchaseDto {
            id: q.purchase_id.clone(),
            sku: q.sku.clone(),
            qty: q.qty,
            unit_cost: q.unit_cost,
            supplier: q.supplier.clone(),
            note: "barcode".into(),
            at: q.at.clone(),
        },
        now,
    )
    .map_err(db)?;
    let last: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(serial), 0) FROM wh_units WHERE sku = ?1",
            [&q.sku],
            |r| r.get(0),
        )
        .map_err(db)?;
    let mut out = Vec::new();
    for i in 1..=q.qty {
        let serial = last + i;
        let u = UnitDto {
            code: format!("{}-{serial:06}", q.sku),
            sku: q.sku.clone(),
            price: q.price,
            cost: q.unit_cost,
            location: q.location.clone(),
            status: "IN_STOCK".into(),
            received_at: now.into(),
            shipped_at: String::new(),
            order_id: String::new(),
        };
        tx.execute(
            "INSERT INTO wh_units (code, sku, serial, price, cost, location, status, received_at)
             VALUES (?1,?2,?3,?4,?5,?6,'IN_STOCK',?7)",
            params![u.code, u.sku, serial, u.price, u.cost, u.location, now],
        )
        .map_err(db)?;
        log(&tx, now, "IN", &u, "")?;
        out.push(u);
    }
    tx.commit().map_err(db)?;
    Ok(out)
}

/// Scan units out. All or nothing: an unknown code, a unit that is not on the shelf or the same
/// code twice stops the whole batch (`UNKNOWN:<code>`, `NOT_IN_STOCK:<code>`, `DUPLICATE:<code>`).
/// `stock_handled` is true when a ship order saved with the sku and quantity already took the
/// units off the stock count.
pub fn ship(
    conn: &Connection,
    codes: &[String],
    order_id: &str,
    stock_handled: bool,
    now: &str,
) -> Res<ShipResult> {
    if codes.is_empty() || codes.len() > 500 {
        return Err("BAD_QTY".into());
    }
    let tx = conn.unchecked_transaction().map_err(db)?;
    let mut seen = std::collections::HashSet::new();
    let mut units = Vec::new();
    for code in codes {
        let code = code.trim();
        if !seen.insert(code.to_string()) {
            return Err(format!("DUPLICATE:{code}"));
        }
        let Some(mut u) = unit_get(&tx, code)? else {
            return Err(format!("UNKNOWN:{code}"));
        };
        if u.status != "IN_STOCK" {
            return Err(format!("NOT_IN_STOCK:{code}"));
        }
        tx.execute(
            "UPDATE wh_units SET status='SHIPPED', shipped_at=?2, order_id=?3 WHERE code=?1",
            params![u.code, now, order_id],
        )
        .map_err(db)?;
        if !stock_handled {
            biz::stock_adjust(&tx, &u.sku, -1, now).map_err(db)?;
        }
        u.status = "SHIPPED".into();
        u.shipped_at = now.into();
        u.order_id = order_id.into();
        log(&tx, now, "OUT", &u, order_id)?;
        units.push(u);
    }
    tx.commit().map_err(db)?;
    let total = units.iter().map(|u| u.price).sum();
    Ok(ShipResult { units, total })
}

pub fn move_to(conn: &Connection, code: &str, location: &str, now: &str) -> Res<UnitDto> {
    if !valid_location(location) {
        return Err("BAD_LOCATION".into());
    }
    let Some(mut u) = unit_get(conn, code)? else {
        return Err(format!("UNKNOWN:{code}"));
    };
    if u.status != "IN_STOCK" {
        return Err(format!("NOT_IN_STOCK:{code}"));
    }
    conn.execute(
        "UPDATE wh_units SET location=?2 WHERE code=?1",
        params![u.code, location],
    )
    .map_err(db)?;
    u.location = location.into();
    log(conn, now, "MOVE", &u, "")?;
    Ok(u)
}

/// Take a unit off the shelf without selling it (lost, damaged, missing at a count).
pub fn void(conn: &Connection, code: &str, reason: &str, now: &str) -> Res<UnitDto> {
    if reason.len() > 40 || reason.chars().any(|c| c.is_control()) {
        return Err("BAD_NOTE".into());
    }
    let tx = conn.unchecked_transaction().map_err(db)?;
    let Some(mut u) = unit_get(&tx, code)? else {
        return Err(format!("UNKNOWN:{code}"));
    };
    if u.status != "IN_STOCK" {
        return Err(format!("NOT_IN_STOCK:{code}"));
    }
    tx.execute("UPDATE wh_units SET status='VOID' WHERE code=?1", [&u.code])
        .map_err(db)?;
    biz::stock_adjust(&tx, &u.sku, -1, now).map_err(db)?;
    u.status = "VOID".into();
    log(&tx, now, "VOID", &u, reason)?;
    tx.commit().map_err(db)?;
    Ok(u)
}

/// A shipped (returned) or voided (found again) unit goes back on the shelf.
pub fn restock(conn: &Connection, code: &str, location: &str, now: &str) -> Res<UnitDto> {
    if !valid_location(location) {
        return Err("BAD_LOCATION".into());
    }
    let tx = conn.unchecked_transaction().map_err(db)?;
    let Some(mut u) = unit_get(&tx, code)? else {
        return Err(format!("UNKNOWN:{code}"));
    };
    if u.status == "IN_STOCK" {
        return Err(format!("ALREADY_IN_STOCK:{code}"));
    }
    tx.execute(
        "UPDATE wh_units SET status='IN_STOCK', location=?2, shipped_at='', order_id='' WHERE code=?1",
        params![u.code, location],
    )
    .map_err(db)?;
    biz::stock_adjust(&tx, &u.sku, 1, now).map_err(db)?;
    u.status = "IN_STOCK".into();
    u.location = location.into();
    log(&tx, now, "RETURN", &u, "")?;
    tx.commit().map_err(db)?;
    Ok(u)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountResult {
    /// On the shelf in the books but not scanned: now voided.
    pub missing: Vec<UnitDto>,
    /// Scanned codes the books do not know, or know as not on the shelf.
    pub unexpected: Vec<String>,
}

/// Finish a stocktake. Units in scope (one location, or all when `location` is empty) that were
/// not scanned are voided as missing.
pub fn count_apply(
    conn: &Connection,
    location: &str,
    scanned: &[String],
    now: &str,
) -> Res<CountResult> {
    if !valid_location(location) {
        return Err("BAD_LOCATION".into());
    }
    let seen: std::collections::HashSet<&str> = scanned.iter().map(|s| s.trim()).collect();
    let mut unexpected = Vec::new();
    for code in &seen {
        match unit_get(conn, code)? {
            Some(u) if u.status == "IN_STOCK" => {}
            _ => unexpected.push((*code).to_string()),
        }
    }
    unexpected.sort();
    let in_scope: Vec<UnitDto> = units_list(conn, "IN_STOCK", 20_000)?
        .into_iter()
        .filter(|u| location.is_empty() || u.location == location)
        .collect();
    let mut missing = Vec::new();
    for u in in_scope {
        if !seen.contains(u.code.as_str()) {
            missing.push(void(conn, &u.code, "COUNT_MISSING", now)?);
        }
    }
    Ok(CountResult {
        missing,
        unexpected,
    })
}

pub fn moves_list(conn: &Connection, limit: i64) -> Res<Vec<MoveDto>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, at, kind, code, sku, location, note FROM wh_moves ORDER BY id DESC LIMIT ?1",
        )
        .map_err(db)?;
    let rows = stmt
        .query_map([limit.clamp(1, 1000)], |r| {
            Ok(MoveDto {
                id: r.get(0)?,
                at: r.get(1)?,
                kind: r.get(2)?,
                code: r.get(3)?,
                sku: r.get(4)?,
                location: r.get(5)?,
                note: r.get(6)?,
            })
        })
        .map_err(db)?;
    rows.collect::<Result<_, _>>().map_err(db)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn req(qty: i64) -> ReceiveReq {
        ReceiveReq {
            purchase_id: format!("p{qty}-{}", std::process::id()),
            sku: "A12".into(),
            qty,
            price: 350,
            unit_cost: 120,
            location: "A1".into(),
            supplier: String::new(),
            at: "2026-10-30".into(),
        }
    }

    fn stock(c: &Connection) -> i64 {
        biz::stock_list(c).unwrap()[0].stock
    }

    #[test]
    fn receiving_makes_one_code_per_unit_and_books_the_purchase() {
        let c = open_in_memory().unwrap();
        let units = receive(&c, &req(3), "t1").unwrap();
        let codes: Vec<_> = units.iter().map(|u| u.code.as_str()).collect();
        assert_eq!(codes, ["A12-000001", "A12-000002", "A12-000003"]);
        assert!(units.iter().all(|u| u.price == 350 && u.location == "A1"));
        assert_eq!(stock(&c), 3);
        // serials continue, never repeat
        let more = receive(&c, &req(2), "t2").unwrap();
        assert_eq!(more[0].code, "A12-000004");
        assert_eq!(stock(&c), 5);
        assert_eq!(moves_list(&c, 100).unwrap().len(), 5);
    }

    #[test]
    fn rejects_bad_receiving() {
        let c = open_in_memory().unwrap();
        let mut r = req(1);
        r.sku = "áo thun".into();
        assert_eq!(receive(&c, &r, "t").unwrap_err(), "BAD_SKU");
        assert_eq!(receive(&c, &req(0), "t").unwrap_err(), "BAD_QTY");
        assert_eq!(receive(&c, &req(501), "t").unwrap_err(), "BAD_QTY");
        let mut r = req(1);
        r.location = "kệ A".into();
        assert_eq!(receive(&c, &r, "t").unwrap_err(), "BAD_LOCATION");
        assert!(biz::stock_list(&c).unwrap().is_empty());
    }

    #[test]
    fn shipping_marks_units_sold_totals_prices_and_cannot_repeat() {
        let c = open_in_memory().unwrap();
        receive(&c, &req(3), "t").unwrap();
        let r = ship(
            &c,
            &["A12-000001".into(), "A12-000002".into()],
            "o1",
            false,
            "t2",
        )
        .unwrap();
        assert_eq!(r.total, 700);
        assert_eq!(stock(&c), 1);
        assert_eq!(
            unit_get(&c, "A12-000001").unwrap().unwrap().status,
            "SHIPPED"
        );
        // the same code again, an unknown code, a duplicate: nothing changes
        assert_eq!(
            ship(&c, &["A12-000001".into()], "", false, "t3").unwrap_err(),
            "NOT_IN_STOCK:A12-000001"
        );
        assert_eq!(
            ship(&c, &["A12-000003".into(), "NOPE".into()], "", false, "t3").unwrap_err(),
            "UNKNOWN:NOPE"
        );
        assert_eq!(
            ship(
                &c,
                &["A12-000003".into(), "A12-000003".into()],
                "",
                false,
                "t3"
            )
            .unwrap_err(),
            "DUPLICATE:A12-000003"
        );
        assert_eq!(stock(&c), 1);
        assert_eq!(
            unit_get(&c, "A12-000003").unwrap().unwrap().status,
            "IN_STOCK"
        );
    }

    #[test]
    fn stock_already_handled_by_the_order_is_not_taken_twice() {
        let c = open_in_memory().unwrap();
        receive(&c, &req(2), "t").unwrap();
        ship(&c, &["A12-000001".into()], "o1", true, "t2").unwrap();
        assert_eq!(stock(&c), 2);
    }

    #[test]
    fn moves_voids_and_returns_keep_the_count_right() {
        let c = open_in_memory().unwrap();
        receive(&c, &req(2), "t").unwrap();
        let u = move_to(&c, "A12-000001", "B2", "t").unwrap();
        assert_eq!(u.location, "B2");
        void(&c, "A12-000001", "DAMAGED", "t").unwrap();
        assert_eq!(stock(&c), 1);
        assert_eq!(
            void(&c, "A12-000001", "DAMAGED", "t").unwrap_err(),
            "NOT_IN_STOCK:A12-000001"
        );
        restock(&c, "A12-000001", "A1", "t").unwrap();
        assert_eq!(stock(&c), 2);
        assert_eq!(
            restock(&c, "A12-000001", "A1", "t").unwrap_err(),
            "ALREADY_IN_STOCK:A12-000001"
        );
        ship(&c, &["A12-000002".into()], "o", false, "t").unwrap();
        restock(&c, "A12-000002", "", "t").unwrap(); // customer returned it
        assert_eq!(stock(&c), 2);
    }

    #[test]
    fn a_count_voids_what_was_not_scanned_and_reports_strangers() {
        let c = open_in_memory().unwrap();
        receive(&c, &req(3), "t").unwrap();
        let mut other = req(1);
        other.purchase_id = "px".into();
        other.location = "B2".into();
        other.sku = "B7".into();
        receive(&c, &other, "t").unwrap();
        // count only shelf A1: scan one of three, plus a code nobody knows
        let r = count_apply(&c, "A1", &["A12-000001".into(), "ZZZ".into()], "t2").unwrap();
        let gone: Vec<_> = r.missing.iter().map(|u| u.code.as_str()).collect();
        assert_eq!(gone, ["A12-000002", "A12-000003"]);
        assert_eq!(r.unexpected, ["ZZZ"]);
        // B2 was out of scope
        assert_eq!(
            unit_get(&c, "B7-000001").unwrap().unwrap().status,
            "IN_STOCK"
        );
        assert_eq!(
            biz::stock_list(&c)
                .unwrap()
                .iter()
                .find(|s| s.sku == "A12")
                .unwrap()
                .stock,
            1
        );
    }

    #[test]
    fn relayed_scan_codes_are_short_printable_and_without_spaces() {
        assert!(valid_scan_code("A12-000001"));
        assert!(!valid_scan_code(""));
        assert!(!valid_scan_code("has space"));
        assert!(!valid_scan_code("line\nbreak"));
        assert!(!valid_scan_code(&"x".repeat(65)));
    }
}

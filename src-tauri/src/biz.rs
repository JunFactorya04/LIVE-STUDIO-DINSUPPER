//! Shop books: stock with cost, purchases, and monthly or one-off expenses. Sales come from the
//! ship orders (their sku, quantity and the unit cost at the time of sale). Everything is whole
//! NT$ and stays on this computer.

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};

const MAX_MONEY: i64 = 10_000_000;
const MAX_QTY: i64 = 1_000_000;

fn bad(msg: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(msg.to_string())
}

fn clean(raw: &str, max: usize) -> Option<String> {
    let t: String = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    (t.chars().count() <= max && !t.chars().any(|c| c.is_control())).then_some(t)
}

fn sku(raw: &str) -> Result<String> {
    let s = clean(raw, 40).filter(|s| !s.is_empty());
    s.ok_or_else(|| bad("sku"))
}

fn date(raw: &str) -> Result<String> {
    // yyyy-mm-dd, optionally followed by a time; only the day is kept.
    let d: String = raw.chars().take(10).collect();
    let ok = d.len() == 10
        && d.char_indices().all(|(i, c)| {
            if i == 4 || i == 7 {
                c == '-'
            } else {
                c.is_ascii_digit()
            }
        });
    ok.then_some(d).ok_or_else(|| bad("date"))
}

// ---------- stock ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StockDto {
    pub sku: String,
    pub cost: i64,
    pub stock: i64,
    pub min_stock: i64,
    #[serde(default)]
    pub updated_at: String,
}

pub fn stock_save(conn: &Connection, s: &StockDto, now: &str) -> Result<()> {
    let sku = sku(&s.sku)?;
    if !(0..=MAX_MONEY).contains(&s.cost) {
        return Err(bad("cost"));
    }
    if !(-MAX_QTY..=MAX_QTY).contains(&s.stock) {
        return Err(bad("stock"));
    }
    if !(0..=MAX_QTY).contains(&s.min_stock) {
        return Err(bad("min_stock"));
    }
    conn.execute(
        "INSERT INTO biz_stock (sku, cost, stock, min_stock, updated_at) VALUES (?1,?2,?3,?4,?5)
         ON CONFLICT(sku) DO UPDATE SET cost=?2, stock=?3, min_stock=?4, updated_at=?5",
        params![sku, s.cost, s.stock, s.min_stock, now],
    )?;
    Ok(())
}

pub fn stock_list(conn: &Connection) -> Result<Vec<StockDto>> {
    let mut stmt =
        conn.prepare("SELECT sku, cost, stock, min_stock, updated_at FROM biz_stock ORDER BY sku")?;
    let rows = stmt.query_map([], |r| {
        Ok(StockDto {
            sku: r.get(0)?,
            cost: r.get(1)?,
            stock: r.get(2)?,
            min_stock: r.get(3)?,
            updated_at: r.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn stock_delete(conn: &Connection, sku: &str) -> Result<usize> {
    conn.execute("DELETE FROM biz_stock WHERE sku = ?1", [sku])
}

/// Change the stock of a sku by `delta` (negative when selling). Creates the row if needed.
pub fn stock_adjust(conn: &Connection, sku: &str, delta: i64, now: &str) -> Result<()> {
    if sku.is_empty() || delta == 0 {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO biz_stock (sku, cost, stock, min_stock, updated_at) VALUES (?1,0,?2,0,?3)
         ON CONFLICT(sku) DO UPDATE SET stock = stock + ?2, updated_at = ?3",
        params![sku, delta, now],
    )?;
    Ok(())
}

pub fn unit_cost(conn: &Connection, sku: &str) -> Result<i64> {
    Ok(conn
        .query_row("SELECT cost FROM biz_stock WHERE sku = ?1", [sku], |r| {
            r.get(0)
        })
        .optional()?
        .unwrap_or(0))
}

// ---------- purchases ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseDto {
    pub id: String,
    pub sku: String,
    pub qty: i64,
    pub unit_cost: i64,
    #[serde(default)]
    pub supplier: String,
    #[serde(default)]
    pub note: String,
    /// Day of the purchase, yyyy-mm-dd.
    pub at: String,
}

/// Record a purchase: stock goes up and the unit cost becomes the weighted average of what was
/// in stock and what just arrived (stock that is zero or negative takes the new price).
pub fn purchase_add(conn: &Connection, p: &PurchaseDto, now: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    purchase_apply(&tx, p, now)?;
    tx.commit()
}

/// The body of `purchase_add`, for a caller that already holds a transaction.
pub fn purchase_apply(tx: &Connection, p: &PurchaseDto, now: &str) -> Result<()> {
    if p.id.is_empty() || p.id.len() > 64 {
        return Err(bad("id"));
    }
    let s = sku(&p.sku)?;
    if !(1..=MAX_QTY).contains(&p.qty) {
        return Err(bad("qty"));
    }
    if !(0..=MAX_MONEY).contains(&p.unit_cost) {
        return Err(bad("unit_cost"));
    }
    let supplier = clean(&p.supplier, 60).ok_or_else(|| bad("supplier"))?;
    let note = clean(&p.note, 200).ok_or_else(|| bad("note"))?;
    let at = date(&p.at)?;
    let (cost, stock): (i64, i64) = tx
        .query_row(
            "SELECT cost, stock FROM biz_stock WHERE sku = ?1",
            [&s],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
        .unwrap_or((0, 0));
    let new_cost = if stock > 0 {
        let total = stock * cost + p.qty * p.unit_cost;
        (total + (stock + p.qty) / 2) / (stock + p.qty) // rounded
    } else {
        p.unit_cost
    };
    tx.execute(
        "INSERT INTO biz_stock (sku, cost, stock, min_stock, updated_at) VALUES (?1,?2,?3,0,?4)
         ON CONFLICT(sku) DO UPDATE SET cost=?2, stock=stock+?3, updated_at=?4",
        params![s, new_cost, p.qty, now],
    )?;
    tx.execute(
        "INSERT INTO biz_purchases (id, sku, qty, unit_cost, supplier, note, at, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![p.id, s, p.qty, p.unit_cost, supplier, note, at, now],
    )?;
    Ok(())
}

pub fn purchase_list(conn: &Connection) -> Result<Vec<PurchaseDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, sku, qty, unit_cost, supplier, note, at FROM biz_purchases
         ORDER BY at DESC, rowid DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(PurchaseDto {
            id: r.get(0)?,
            sku: r.get(1)?,
            qty: r.get(2)?,
            unit_cost: r.get(3)?,
            supplier: r.get(4)?,
            note: r.get(5)?,
            at: r.get(6)?,
        })
    })?;
    rows.collect()
}

/// Remove a purchase entered by mistake: the stock it added is taken back (the average cost is
/// left as it is; correct it in the stock list if needed).
pub fn purchase_delete(conn: &Connection, id: &str, now: &str) -> Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let row: Option<(String, i64)> = tx
        .query_row(
            "SELECT sku, qty FROM biz_purchases WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((s, qty)) = row else {
        return Ok(0);
    };
    stock_adjust(&tx, &s, -qty, now)?;
    let n = tx.execute("DELETE FROM biz_purchases WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(n)
}

// ---------- expenses ----------

/// Fixed list of expense groups (the screen shows their names); anything else is rejected.
pub const CATEGORIES: [&str; 13] = [
    "RENT",
    "SALARY",
    "PLATFORM",
    "PAYMENT",
    "ADS",
    "SHIPPING",
    "PACKAGING",
    "UTILITY",
    "SOFTWARE",
    "TAX",
    "DEPRECIATION",
    "RETURNS",
    "OTHER",
];

fn other() -> String {
    "OTHER".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseDto {
    pub id: String,
    pub name: String,
    pub amount: i64,
    /// "FIXED" = every month from `at`'s month on while active; "ONCE" = only on day `at`;
    /// "PERCENT" = a share of sales from `at` on, with `amount` in basis points (250 = 2.50%).
    pub kind: String,
    pub at: String,
    #[serde(default = "other")]
    pub category: String,
    #[serde(default = "yes")]
    pub active: bool,
}

fn yes() -> bool {
    true
}

pub fn expense_save(conn: &Connection, e: &ExpenseDto, now: &str) -> Result<()> {
    if e.id.is_empty() || e.id.len() > 64 {
        return Err(bad("id"));
    }
    let name = clean(&e.name, 60)
        .filter(|n| !n.is_empty())
        .ok_or_else(|| bad("name"))?;
    if !(0..=MAX_MONEY).contains(&e.amount) {
        return Err(bad("amount"));
    }
    if !matches!(e.kind.as_str(), "FIXED" | "ONCE" | "PERCENT") {
        return Err(bad("kind"));
    }
    if e.kind == "PERCENT" && e.amount > 10_000 {
        return Err(bad("amount"));
    }
    if !CATEGORIES.contains(&e.category.as_str()) {
        return Err(bad("category"));
    }
    let at = date(&e.at)?;
    conn.execute(
        "INSERT INTO biz_expenses (id, name, amount, kind, at, active, created_at, category)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
         ON CONFLICT(id) DO UPDATE SET name=?2, amount=?3, kind=?4, at=?5, active=?6, category=?8",
        params![
            e.id,
            name,
            e.amount,
            e.kind,
            at,
            e.active as i64,
            now,
            e.category
        ],
    )?;
    Ok(())
}

pub fn expense_list(conn: &Connection) -> Result<Vec<ExpenseDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, amount, kind, at, active, category FROM biz_expenses ORDER BY kind, name",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ExpenseDto {
            id: r.get(0)?,
            name: r.get(1)?,
            amount: r.get(2)?,
            kind: r.get(3)?,
            at: r.get(4)?,
            active: r.get::<_, i64>(5)? != 0,
            category: r.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn expense_delete(conn: &Connection, id: &str) -> Result<usize> {
    conn.execute("DELETE FROM biz_expenses WHERE id = ?1", [id])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn purchase(id: &str, qty: i64, cost: i64) -> PurchaseDto {
        PurchaseDto {
            id: id.into(),
            sku: "A12".into(),
            qty,
            unit_cost: cost,
            supplier: "Chợ A".into(),
            note: String::new(),
            at: "2026-10-01".into(),
        }
    }

    #[test]
    fn purchases_average_the_cost_and_can_be_undone() {
        let c = open_in_memory().unwrap();
        purchase_add(&c, &purchase("p1", 10, 100), "t").unwrap();
        purchase_add(&c, &purchase("p2", 10, 200), "t").unwrap();
        let s = &stock_list(&c).unwrap()[0];
        assert_eq!((s.stock, s.cost), (20, 150));
        assert_eq!(purchase_delete(&c, "p2", "t").unwrap(), 1);
        assert_eq!(stock_list(&c).unwrap()[0].stock, 10);
        assert_eq!(purchase_list(&c).unwrap().len(), 1);
        assert_eq!(purchase_delete(&c, "missing", "t").unwrap(), 0);
    }

    #[test]
    fn rejects_bad_purchase_and_expense() {
        let c = open_in_memory().unwrap();
        assert!(purchase_add(&c, &purchase("p", 0, 100), "t").is_err());
        assert!(purchase_add(&c, &purchase("p", 1, -5), "t").is_err());
        let mut p = purchase("p", 1, 5);
        p.at = "10/01/2026".into();
        assert!(purchase_add(&c, &p, "t").is_err());
        let e = ExpenseDto {
            id: "e1".into(),
            name: "Thuê kho".into(),
            amount: 5000,
            kind: "FIXED".into(),
            at: "2026-10-01".into(),
            category: "RENT".into(),
            active: true,
        };
        expense_save(&c, &e, "t").unwrap();
        assert_eq!(expense_list(&c).unwrap()[0].category, "RENT");
        // A share of sales is kept in basis points and cannot pass 100%.
        let pct = ExpenseDto {
            id: "e2".into(),
            name: "Phí sàn".into(),
            amount: 250,
            kind: "PERCENT".into(),
            category: "PLATFORM".into(),
            ..e.clone()
        };
        expense_save(&c, &pct, "t").unwrap();
        assert!(expense_save(
            &c,
            &ExpenseDto {
                amount: 10_001,
                ..pct.clone()
            },
            "t"
        )
        .is_err());
        assert!(expense_save(
            &c,
            &ExpenseDto {
                category: "NOPE".into(),
                ..e.clone()
            },
            "t"
        )
        .is_err());
        assert_eq!(expense_delete(&c, "e2").unwrap(), 1);
        assert_eq!(expense_list(&c).unwrap().len(), 1);
        assert!(expense_save(
            &c,
            &ExpenseDto {
                kind: "X".into(),
                ..e.clone()
            },
            "t"
        )
        .is_err());
        assert!(expense_save(
            &c,
            &ExpenseDto {
                name: " ".into(),
                ..e.clone()
            },
            "t"
        )
        .is_err());
        assert_eq!(expense_delete(&c, "e1").unwrap(), 1);
    }

    #[test]
    fn stock_save_and_adjust() {
        let c = open_in_memory().unwrap();
        stock_save(
            &c,
            &StockDto {
                sku: "B1".into(),
                cost: 80,
                stock: 5,
                min_stock: 2,
                updated_at: String::new(),
            },
            "t",
        )
        .unwrap();
        stock_adjust(&c, "B1", -3, "t").unwrap();
        assert_eq!(stock_list(&c).unwrap()[0].stock, 2);
        assert_eq!(unit_cost(&c, "B1").unwrap(), 80);
        assert_eq!(unit_cost(&c, "none").unwrap(), 0);
    }
}

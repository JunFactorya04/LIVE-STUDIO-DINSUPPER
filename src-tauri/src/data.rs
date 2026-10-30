//! Hardening: audit log, per-session report, export, retention, backup, wipe.
//!
//! The audit log records WHAT the seller did (codes and counts), never comment text, names,
//! keys or AI prompts. Details are filtered to a safe character set before they are stored.

use crate::{live, orders, replies};
use rusqlite::{params, Connection, Result};
use serde::Serialize;

pub const MAX_AUDIT_ROWS: i64 = 1000;
pub const MAX_DETAIL_CHARS: usize = 120;
/// Upper bound of rows exported for one session.
const EXPORT_LIMIT: usize = 1_000_000;

pub const AUDIT_ACTIONS: &[&str] = &[
    "SESSION_START",
    "SESSION_DELETE",
    "ORDER_CONFIRMED",
    "ORDER_CANCELLED",
    "REPLY_COPIED",
    "REPLY_REJECTED",
    "SECRET_SET",
    "SECRET_REMOVE",
    "AI_CALL_OK",
    "AI_CALL_ERROR",
    "EULER_CONNECT",
    "EULER_DISCONNECT",
    "EXPORT",
    "BACKUP",
    "RETENTION_PURGE",
    "DELETE_ALL",
    "PRINT_OK",
    "PRINT_ERROR",
    "SHIP_SAVED",
    "SHIP_DELETED",
    "SHIP_EXPORTED",
    "SHIP_STORES_IMPORT",
];

fn bad(msg: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(msg.to_string())
}

/// Keep only characters that cannot carry a sentence of user text: letters, digits and a few
/// separators. Names such as "provider=openai code=QUOTA" survive; free text is cut short.
pub fn safe_detail(detail: &str) -> String {
    detail
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || " _:.,=-".contains(*c))
        .take(MAX_DETAIL_CHARS)
        .collect()
}

pub fn audit(conn: &Connection, action: &str, detail: &str) -> Result<()> {
    if !AUDIT_ACTIONS.contains(&action) {
        return Err(bad("action"));
    }
    conn.execute(
        "INSERT INTO audit_log (action, detail) VALUES (?1, ?2)",
        params![action, safe_detail(detail)],
    )?;
    // Bounded: the oldest rows go first.
    conn.execute(
        "DELETE FROM audit_log WHERE id <= (SELECT MAX(id) FROM audit_log) - ?1",
        [MAX_AUDIT_ROWS],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuditDto {
    pub id: i64,
    pub at: String,
    pub action: String,
    pub detail: String,
}

pub fn audit_list(conn: &Connection, limit: usize) -> Result<Vec<AuditDto>> {
    let mut stmt =
        conn.prepare("SELECT id, at, action, detail FROM audit_log ORDER BY id DESC LIMIT ?1")?;
    let rows = stmt.query_map([limit.min(500) as i64], |r| {
        Ok(AuditDto {
            id: r.get(0)?,
            at: r.get(1)?,
            action: r.get(2)?,
            detail: r.get(3)?,
        })
    })?;
    rows.collect()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub username: Option<String>,
    pub provider_type: String,
    pub status: String,
    pub created_at: String,
    pub comments: i64,
    pub orders_draft: i64,
    pub orders_needs_review: i64,
    pub orders_confirmed: i64,
    pub orders_cancelled: i64,
    pub replies: i64,
    pub replies_copied: i64,
}

const SUMMARY_SQL: &str = "
SELECT s.id, s.username, s.provider_type, s.status, s.created_at,
  (SELECT COUNT(*) FROM live_comments c WHERE c.session_id = s.id),
  (SELECT COUNT(*) FROM live_order_drafts d WHERE d.session_id = s.id AND d.status = 'DRAFT'),
  (SELECT COUNT(*) FROM live_order_drafts d WHERE d.session_id = s.id AND d.status = 'NEEDS_REVIEW'),
  (SELECT COUNT(*) FROM live_order_drafts d WHERE d.session_id = s.id AND d.status = 'CONFIRMED'),
  (SELECT COUNT(*) FROM live_order_drafts d WHERE d.session_id = s.id AND d.status = 'CANCELLED'),
  (SELECT COUNT(*) FROM live_reply_suggestions r WHERE r.session_id = s.id),
  (SELECT COUNT(*) FROM live_reply_suggestions r WHERE r.session_id = s.id AND r.status = 'COPIED')
FROM live_sessions s";

fn summary_row(r: &rusqlite::Row<'_>) -> Result<SessionSummary> {
    Ok(SessionSummary {
        id: r.get(0)?,
        username: r.get(1)?,
        provider_type: r.get(2)?,
        status: r.get(3)?,
        created_at: r.get(4)?,
        comments: r.get(5)?,
        orders_draft: r.get(6)?,
        orders_needs_review: r.get(7)?,
        orders_confirmed: r.get(8)?,
        orders_cancelled: r.get(9)?,
        replies: r.get(10)?,
        replies_copied: r.get(11)?,
    })
}

/// Newest sessions first, at most 200.
pub fn session_summaries(conn: &Connection) -> Result<Vec<SessionSummary>> {
    let mut stmt = conn.prepare(&format!(
        "{SUMMARY_SQL} ORDER BY s.created_at DESC, s.rowid DESC LIMIT 200"
    ))?;
    let rows = stmt.query_map([], summary_row)?;
    rows.collect()
}

fn one_summary(conn: &Connection, id: &str) -> Result<SessionSummary> {
    conn.query_row(&format!("{SUMMARY_SQL} WHERE s.id = ?1"), [id], summary_row)
}

/// Everything about one session as pretty JSON, for the seller's own records.
pub fn export_json(conn: &Connection, session_id: &str) -> Result<String> {
    let summary = one_summary(conn, session_id)?;
    let comments = live::list_comments(conn, session_id, EXPORT_LIMIT)?;
    let orders = orders::order_list(conn, session_id)?;
    let replies = replies::reply_list(conn, session_id)?;
    serde_json::to_string_pretty(&serde_json::json!({
        "format": "live-studio-session-v1",
        "summary": summary,
        "comments": comments,
        "orders": orders,
        "replies": replies,
    }))
    .map_err(|e| bad(&e.to_string()))
}

/// A spreadsheet must never run a comment as a formula: cells that start with = + - @ or a tab
/// or carriage return get a leading apostrophe.
pub fn csv_cell(value: &str) -> String {
    let mut v = value.replace(['\r', '\n'], " ");
    if v.starts_with(['=', '+', '-', '@', '\t']) {
        v.insert(0, '\'');
    }
    if v.contains([',', '"']) {
        v = format!("\"{}\"", v.replace('"', "\"\""));
    }
    v
}

/// Orders as CSV (UTF-8 with BOM so Excel opens Chinese and Vietnamese correctly).
pub fn export_orders_csv(conn: &Connection, session_id: &str) -> Result<String> {
    let orders = orders::order_list(conn, session_id)?;
    let mut out = String::from(
        "\u{feff}username,sku,color,size,quantity,status,confidence,reasons,created_at\n",
    );
    for o in orders {
        let cells = [
            csv_cell(o.username.as_deref().unwrap_or("")),
            csv_cell(o.sku.as_deref().unwrap_or("")),
            csv_cell(o.color.as_deref().unwrap_or("")),
            csv_cell(o.size.as_deref().unwrap_or("")),
            o.quantity.map(|q| q.to_string()).unwrap_or_default(),
            o.status.clone(),
            format!("{:.2}", o.confidence),
            csv_cell(&o.reasons.join("|")),
            csv_cell(&o.created_at),
        ];
        out.push_str(&cells.join(","));
        out.push('\n');
    }
    Ok(out)
}

/// Delete sessions created more than `days` days ago (their comments, drafts and replies go
/// with them). `days == 0` deletes nothing: 0 means "keep forever". Returns sessions removed.
pub fn purge_older_than(conn: &Connection, days: u32) -> Result<usize> {
    if days == 0 {
        return Ok(0);
    }
    let cutoff = format!("-{days} days");
    // Shipping data holds names and phone numbers, so it follows the same retention.
    for table in ["ship_orders", "ship_customers"] {
        conn.execute(
            &format!(
                "DELETE FROM {table}
                 WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?1)"
            ),
            [&cutoff],
        )?;
    }
    conn.execute(
        "DELETE FROM live_sessions
         WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?1)",
        [&cutoff],
    )
}

/// Delete every session and its data. The catalog is kept unless asked for.
pub fn delete_all(conn: &Connection, include_catalog: bool) -> Result<usize> {
    let n = conn.execute("DELETE FROM live_sessions", [])?;
    conn.execute("DELETE FROM ship_orders", [])?;
    conn.execute("DELETE FROM ship_customers", [])?;
    if include_catalog {
        conn.execute("DELETE FROM catalog_items", [])?;
    }
    Ok(n)
}

/// Consistent copy of the whole database into a new file (`VACUUM INTO`).
pub fn backup_to(conn: &Connection, dest: &std::path::Path) -> Result<()> {
    if dest.exists() {
        return Err(bad("exists"));
    }
    let path = dest.to_str().ok_or_else(|| bad("path"))?;
    conn.execute("VACUUM INTO ?1", [path])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn setup() -> Connection {
        let c = open_in_memory().unwrap();
        for id in ["s1", "s2"] {
            c.execute(
                "INSERT INTO live_sessions (id, provider_type, status, username)
                 VALUES (?1, 'manual', 'MANUAL', 'shop')",
                [id],
            )
            .unwrap();
        }
        c
    }

    fn comment(c: &Connection, sid: &str, n: usize) {
        c.execute(
            "INSERT INTO live_comments (session_id, provider_event_id, username, comment_text,
               comment_timestamp, received_at, source)
             VALUES (?1, ?2, 'ann', ?3, 't', 't', 'MANUAL')",
            params![sid, format!("e{n}"), format!("=HYPERLINK(\"x\") {n}")],
        )
        .unwrap();
    }

    fn order(c: &Connection, sid: &str, id: &str, status: &str) {
        c.execute(
            "INSERT INTO live_order_drafts (id, session_id, username, sku, quantity, confidence,
               status, created_at, updated_at)
             VALUES (?1, ?2, '@evil', 'A1', 2, 0.9, ?3, 't', 't')",
            params![id, sid, status],
        )
        .unwrap();
    }

    #[test]
    fn audit_keeps_codes_and_drops_free_text() {
        let c = setup();
        audit(&c, "AI_CALL_ERROR", "provider=openai code=QUOTA").unwrap();
        audit(
            &c,
            "ORDER_CONFIRMED",
            "電話 0912345678 地址 台北市 <b>x</b>",
        )
        .unwrap();
        let rows = audit_list(&c, 10).unwrap();
        assert_eq!(rows[1].detail, "provider=openai code=QUOTA");
        // Chinese, brackets and the like are filtered out; only ASCII digits and letters stay.
        assert!(!rows[0].detail.contains('電') && !rows[0].detail.contains('<'));
        assert!(audit(&c, "NOT_AN_ACTION", "").is_err());
        let long = "a".repeat(500);
        audit(&c, "EXPORT", &long).unwrap();
        assert_eq!(audit_list(&c, 1).unwrap()[0].detail.len(), MAX_DETAIL_CHARS);
    }

    #[test]
    fn audit_log_is_bounded() {
        let c = setup();
        for _ in 0..(MAX_AUDIT_ROWS + 50) {
            audit(&c, "EXPORT", "x").unwrap();
        }
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, MAX_AUDIT_ROWS);
    }

    #[test]
    fn summaries_count_per_session() {
        let c = setup();
        comment(&c, "s1", 1);
        comment(&c, "s1", 2);
        order(&c, "s1", "o1", "CONFIRMED");
        order(&c, "s1", "o2", "NEEDS_REVIEW");
        let all = session_summaries(&c).unwrap();
        let s1 = all.iter().find(|s| s.id == "s1").unwrap();
        assert_eq!(
            (s1.comments, s1.orders_confirmed, s1.orders_needs_review),
            (2, 1, 1)
        );
        let s2 = all.iter().find(|s| s.id == "s2").unwrap();
        assert_eq!((s2.comments, s2.orders_confirmed), (0, 0));
    }

    #[test]
    fn csv_cells_cannot_become_formulas() {
        assert_eq!(csv_cell("=1+1"), "'=1+1");
        assert_eq!(csv_cell("@SUM(A1)"), "'@SUM(A1)");
        assert_eq!(csv_cell("a,b"), "\"a,b\"");
        assert_eq!(csv_cell("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(csv_cell("line1\nline2"), "line1 line2");
        assert_eq!(csv_cell("plain"), "plain");
    }

    #[test]
    fn exports_contain_only_the_chosen_session() {
        let c = setup();
        comment(&c, "s1", 1);
        comment(&c, "s2", 2);
        order(&c, "s1", "o1", "CONFIRMED");
        order(&c, "s2", "o2", "CONFIRMED");
        let json: serde_json::Value =
            serde_json::from_str(&export_json(&c, "s1").unwrap()).unwrap();
        assert_eq!(json["comments"].as_array().unwrap().len(), 1);
        assert_eq!(json["orders"].as_array().unwrap().len(), 1);
        assert_eq!(json["summary"]["id"], "s1");
        let csv = export_orders_csv(&c, "s1").unwrap();
        assert!(csv.starts_with('\u{feff}'));
        assert_eq!(csv.lines().count(), 2);
        // "@evil" starts with @, so it is neutralised.
        assert!(csv.contains("'@evil"));
        assert!(export_json(&c, "missing").is_err());
    }

    #[test]
    fn purge_respects_age_and_zero_means_keep() {
        let c = setup();
        c.execute(
            "UPDATE live_sessions SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = 's1'",
            [],
        )
        .unwrap();
        comment(&c, "s1", 1);
        assert_eq!(purge_older_than(&c, 0).unwrap(), 0);
        assert_eq!(purge_older_than(&c, 30).unwrap(), 1);
        let ids: Vec<String> = session_summaries(&c)
            .unwrap()
            .into_iter()
            .map(|s| s.id)
            .collect();
        assert_eq!(ids, vec!["s2".to_string()]);
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM live_comments", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn delete_all_keeps_catalog_unless_asked() {
        let c = setup();
        c.execute(
            "INSERT INTO catalog_items (sku, name) VALUES ('A1','Shirt')",
            [],
        )
        .unwrap();
        comment(&c, "s1", 1);
        assert_eq!(delete_all(&c, false).unwrap(), 2);
        let cat = |c: &Connection| -> i64 {
            c.query_row("SELECT COUNT(*) FROM catalog_items", [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(cat(&c), 1);
        delete_all(&c, true).unwrap();
        assert_eq!(cat(&c), 0);
    }

    #[test]
    fn backup_is_a_readable_copy_and_never_overwrites() {
        let c = setup();
        comment(&c, "s1", 1);
        let dir = std::env::temp_dir().join(format!("live-studio-bk-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("copy.db");
        backup_to(&c, &dest).unwrap();
        let copy = crate::db::open(&dest).unwrap();
        let n: i64 = copy
            .query_row("SELECT COUNT(*) FROM live_comments", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        assert!(backup_to(&c, &dest).is_err());
        drop(copy);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn load_ten_thousand_comments_stays_fast() {
        let mut c = setup();
        let batch: Vec<live::CommentDto> = (0..10_000)
            .map(|n| live::CommentDto {
                event_id: format!("e{n}"),
                session_id: "s1".into(),
                username: Some(format!("user{}", n % 300)),
                comment_text: format!("我要 A1 黑色 L {n}"),
                comment_timestamp: "t".into(),
                received_at: "t".into(),
                source: "MANUAL".into(),
                intent: None,
                intent_confidence: None,
            })
            .collect();
        let start = std::time::Instant::now();
        for chunk in batch.chunks(live::MAX_BATCH) {
            live::ingest_comments(&mut c, chunk).unwrap();
        }
        // A repeat of the same events adds nothing.
        for chunk in batch.chunks(live::MAX_BATCH) {
            assert_eq!(live::ingest_comments(&mut c, chunk).unwrap(), 0);
        }
        let all = session_summaries(&c).unwrap();
        let s = all.iter().find(|s| s.id == "s1").unwrap();
        assert_eq!(s.comments, 10_000);
        assert!(export_json(&c, "s1").unwrap().len() > 100_000);
        assert!(start.elapsed().as_secs() < 20, "took {:?}", start.elapsed());
    }
}

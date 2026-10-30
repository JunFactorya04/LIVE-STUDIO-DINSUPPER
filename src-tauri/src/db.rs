//! SQLite connection and migrations. One database file for the whole app
//! (docs/IMPLEMENTATION_PLAN_TIKTOK_LIVE.md: no second database just for LIVE).

use rusqlite::{Connection, Result};
use std::path::Path;

const MIGRATION_1: &str = "
CREATE TABLE live_sessions (
    id            TEXT PRIMARY KEY,
    platform      TEXT NOT NULL DEFAULT 'tiktok',
    live_url      TEXT,
    username      TEXT,
    provider_type TEXT NOT NULL,
    status        TEXT NOT NULL,
    started_at    TEXT,
    ended_at      TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE live_comments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id        TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    provider_event_id TEXT NOT NULL,
    platform_user_id  TEXT,
    username          TEXT,
    comment_text      TEXT NOT NULL,
    comment_timestamp TEXT NOT NULL,
    received_at       TEXT NOT NULL,
    source            TEXT NOT NULL,
    processing_status TEXT NOT NULL DEFAULT 'PENDING',
    intent            TEXT,
    confidence        REAL,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- One event is stored once, also after a reconnect or a repeated paste.
CREATE UNIQUE INDEX uq_live_comments_event
    ON live_comments(session_id, source, provider_event_id);
CREATE INDEX ix_live_comments_session_order
    ON live_comments(session_id, id);
";

const MIGRATION_2: &str = "
CREATE TABLE catalog_items (
    sku        TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    price      REAL,
    colors     TEXT NOT NULL DEFAULT '[]',
    sizes      TEXT NOT NULL DEFAULT '[]',
    aliases    TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE live_order_drafts (
    id               TEXT PRIMARY KEY,
    session_id       TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    platform_user_id TEXT,
    username         TEXT,
    sku              TEXT,
    variant_json     TEXT NOT NULL DEFAULT '{}',
    quantity         INTEGER,
    confidence       REAL NOT NULL,
    status           TEXT NOT NULL,
    review_reason    TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);
CREATE INDEX ix_order_drafts_session ON live_order_drafts(session_id, created_at);

CREATE TABLE live_order_evidence (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_draft_id TEXT NOT NULL REFERENCES live_order_drafts(id) ON DELETE CASCADE,
    event_id       TEXT NOT NULL,
    field_name     TEXT NOT NULL,
    evidence_text  TEXT NOT NULL
);
CREATE INDEX ix_order_evidence_draft ON live_order_evidence(order_draft_id);
";

const MIGRATION_3: &str = "
CREATE TABLE live_reply_suggestions (
    id               TEXT PRIMARY KEY,
    session_id       TEXT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    event_id         TEXT NOT NULL,
    source           TEXT NOT NULL,
    suggested_text   TEXT NOT NULL,
    model_provider   TEXT,
    model_name       TEXT,
    status           TEXT NOT NULL,
    approved_by_user INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    sent_at          TEXT
);
CREATE INDEX ix_reply_suggestions_session ON live_reply_suggestions(session_id, created_at);
";

const MIGRATION_4: &str = "
CREATE TABLE audit_log (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
);
";

const MIGRATION_5: &str = "
CREATE TABLE ship_customers (
    tiktok_id  TEXT PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT '',
    phone      TEXT NOT NULL DEFAULT '',
    store_code TEXT NOT NULL DEFAULT '',
    store_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE ship_orders (
    id             TEXT PRIMARY KEY,
    tiktok_id      TEXT NOT NULL DEFAULT '',
    recipient_name TEXT NOT NULL,
    phone          TEXT NOT NULL,
    temperature    TEXT NOT NULL,
    store_code     TEXT NOT NULL,
    store_name     TEXT NOT NULL DEFAULT '',
    product        TEXT NOT NULL,
    note           TEXT NOT NULL DEFAULT '',
    amount         INTEGER NOT NULL,
    shipping_fee   INTEGER NOT NULL,
    cod            INTEGER NOT NULL,
    exported       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
CREATE INDEX ix_ship_orders_created ON ship_orders(created_at);

CREATE TABLE ship_stores (
    code    TEXT PRIMARY KEY,
    name    TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT ''
);
";

const MIGRATION_6: &str = "
CREATE TABLE buyer_flow (
    tiktok_id       TEXT PRIMARY KEY,
    slip_printed_at TEXT,
    ask_copied_at   TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
";

fn configure(conn: &Connection) -> Result<()> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(())
}

/// Apply pending migrations, tracked in `PRAGMA user_version`. Safe to call on every start.
pub fn migrate(conn: &Connection) -> Result<()> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version < 1 {
        conn.execute_batch(&format!(
            "BEGIN;{MIGRATION_1}PRAGMA user_version = 1;COMMIT;"
        ))?;
    }
    if version < 2 {
        conn.execute_batch(&format!(
            "BEGIN;{MIGRATION_2}PRAGMA user_version = 2;COMMIT;"
        ))?;
    }
    if version < 3 {
        conn.execute_batch(&format!(
            "BEGIN;{MIGRATION_3}PRAGMA user_version = 3;COMMIT;"
        ))?;
    }
    if version < 4 {
        conn.execute_batch(&format!(
            "BEGIN;{MIGRATION_4}PRAGMA user_version = 4;COMMIT;"
        ))?;
    }
    if version < 5 {
        conn.execute_batch(&format!(
            "BEGIN;{MIGRATION_5}PRAGMA user_version = 5;COMMIT;"
        ))?;
    }
    if version < 6 {
        conn.execute_batch(&format!(
            "BEGIN;{MIGRATION_6}PRAGMA user_version = 6;COMMIT;"
        ))?;
    }
    Ok(())
}

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&conn)?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_is_idempotent() {
        let conn = open_in_memory().unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        let v: i32 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, 6);
    }

    #[test]
    fn file_database_persists_across_opens() {
        let dir = std::env::temp_dir().join(format!("live-studio-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.db");
        {
            let conn = open(&path).unwrap();
            conn.execute(
                "INSERT INTO live_sessions (id, provider_type, status) VALUES ('s1','manual','MANUAL')",
                [],
            )
            .unwrap();
        }
        let conn = open(&path).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM live_sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }
}

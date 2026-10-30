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
        assert_eq!(v, 2);
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

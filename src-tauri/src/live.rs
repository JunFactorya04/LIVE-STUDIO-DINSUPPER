//! Live sessions and comments: pure functions over a `rusqlite::Connection`
//! so they can be tested with an in-memory database.

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};

pub const MAX_BATCH: usize = 1000;
pub const MAX_COMMENT_CHARS: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionDto {
    pub id: String,
    pub live_url: Option<String>,
    pub username: Option<String>,
    pub provider_type: String,
    pub status: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NewSession {
    pub id: String,
    pub live_url: Option<String>,
    pub username: Option<String>,
    pub provider_type: String,
    pub status: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPatch {
    pub status: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommentDto {
    pub event_id: String,
    pub session_id: String,
    pub username: Option<String>,
    pub comment_text: String,
    pub comment_timestamp: String,
    pub received_at: String,
    pub source: String,
}

pub fn create_session(conn: &Connection, s: &NewSession) -> Result<()> {
    conn.execute(
        "INSERT INTO live_sessions (id, live_url, username, provider_type, status)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![s.id, s.live_url, s.username, s.provider_type, s.status],
    )?;
    Ok(())
}

pub fn update_session(conn: &Connection, id: &str, p: &SessionPatch) -> Result<()> {
    conn.execute(
        "UPDATE live_sessions SET
            status     = COALESCE(?2, status),
            started_at = COALESCE(?3, started_at),
            ended_at   = COALESCE(?4, ended_at)
         WHERE id = ?1",
        params![id, p.status, p.started_at, p.ended_at],
    )?;
    Ok(())
}

pub fn latest_session(conn: &Connection) -> Result<Option<SessionDto>> {
    conn.query_row(
        "SELECT id, live_url, username, provider_type, status, started_at, ended_at
         FROM live_sessions ORDER BY created_at DESC, rowid DESC LIMIT 1",
        [],
        |r| {
            Ok(SessionDto {
                id: r.get(0)?,
                live_url: r.get(1)?,
                username: r.get(2)?,
                provider_type: r.get(3)?,
                status: r.get(4)?,
                started_at: r.get(5)?,
                ended_at: r.get(6)?,
            })
        },
    )
    .optional()
}

fn clip(text: &str) -> String {
    text.chars().take(MAX_COMMENT_CHARS).collect()
}

/// Insert a batch in one transaction. Duplicates (same session, source, event id) and empty
/// comments are skipped. Returns how many rows were really inserted.
pub fn ingest_comments(conn: &mut Connection, batch: &[CommentDto]) -> Result<usize> {
    let batch = &batch[..batch.len().min(MAX_BATCH)];
    let tx = conn.transaction()?;
    let mut inserted = 0;
    {
        let mut stmt = tx.prepare(
            "INSERT OR IGNORE INTO live_comments
               (session_id, provider_event_id, username, comment_text,
                comment_timestamp, received_at, source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for c in batch {
            let text = clip(c.comment_text.trim());
            if text.is_empty() || c.event_id.is_empty() {
                continue;
            }
            inserted += stmt.execute(params![
                c.session_id,
                c.event_id,
                c.username,
                text,
                c.comment_timestamp,
                c.received_at,
                c.source
            ])?;
        }
    }
    tx.commit()?;
    Ok(inserted)
}

/// The latest `limit` comments of a session, oldest first.
pub fn list_comments(conn: &Connection, session_id: &str, limit: usize) -> Result<Vec<CommentDto>> {
    let mut stmt = conn.prepare(
        "SELECT provider_event_id, session_id, username, comment_text,
                comment_timestamp, received_at, source
         FROM (SELECT * FROM live_comments WHERE session_id = ?1 ORDER BY id DESC LIMIT ?2)
         ORDER BY id ASC",
    )?;
    let rows = stmt.query_map(params![session_id, limit as i64], |r| {
        Ok(CommentDto {
            event_id: r.get(0)?,
            session_id: r.get(1)?,
            username: r.get(2)?,
            comment_text: r.get(3)?,
            comment_timestamp: r.get(4)?,
            received_at: r.get(5)?,
            source: r.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn delete_comments(conn: &Connection, session_id: &str) -> Result<usize> {
    conn.execute(
        "DELETE FROM live_comments WHERE session_id = ?1",
        [session_id],
    )
}

pub fn delete_session(conn: &Connection, session_id: &str) -> Result<usize> {
    conn.execute("DELETE FROM live_sessions WHERE id = ?1", [session_id])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn session(id: &str) -> NewSession {
        NewSession {
            id: id.into(),
            live_url: None,
            username: Some("shop".into()),
            provider_type: "manual".into(),
            status: "MANUAL".into(),
        }
    }

    fn comment(sid: &str, eid: &str, text: &str) -> CommentDto {
        CommentDto {
            event_id: eid.into(),
            session_id: sid.into(),
            username: Some("amy".into()),
            comment_text: text.into(),
            comment_timestamp: "2026-10-30T02:00:00Z".into(),
            received_at: "2026-10-30T02:00:00Z".into(),
            source: "MANUAL".into(),
        }
    }

    #[test]
    fn duplicates_are_stored_once() {
        let mut c = open_in_memory().unwrap();
        create_session(&c, &session("s1")).unwrap();
        let n = ingest_comments(
            &mut c,
            &[
                comment("s1", "e1", "黑色 M ×2 🔥"),
                comment("s1", "e1", "黑色 M ×2 🔥"),
            ],
        )
        .unwrap();
        assert_eq!(n, 1);
        let again = ingest_comments(&mut c, &[comment("s1", "e1", "x")]).unwrap();
        assert_eq!(again, 0);
        assert_eq!(list_comments(&c, "s1", 10).unwrap().len(), 1);
    }

    #[test]
    fn empty_and_oversized_comments() {
        let mut c = open_in_memory().unwrap();
        create_session(&c, &session("s1")).unwrap();
        let long = "啊".repeat(5000);
        let n = ingest_comments(
            &mut c,
            &[comment("s1", "e1", "   "), comment("s1", "e2", &long)],
        )
        .unwrap();
        assert_eq!(n, 1);
        let rows = list_comments(&c, "s1", 10).unwrap();
        assert_eq!(rows[0].comment_text.chars().count(), MAX_COMMENT_CHARS);
    }

    #[test]
    fn list_returns_latest_in_chronological_order() {
        let mut c = open_in_memory().unwrap();
        create_session(&c, &session("s1")).unwrap();
        let batch: Vec<_> = (0..5)
            .map(|i| comment("s1", &format!("e{i}"), &format!("t{i}")))
            .collect();
        ingest_comments(&mut c, &batch).unwrap();
        let rows = list_comments(&c, "s1", 3).unwrap();
        let texts: Vec<_> = rows.iter().map(|r| r.comment_text.as_str()).collect();
        assert_eq!(texts, ["t2", "t3", "t4"]);
    }

    #[test]
    fn same_event_id_in_other_session_or_source_is_kept() {
        let mut c = open_in_memory().unwrap();
        create_session(&c, &session("s1")).unwrap();
        create_session(&c, &session("s2")).unwrap();
        let mut other_source = comment("s1", "e1", "b");
        other_source.source = "DEMO".into();
        let n = ingest_comments(
            &mut c,
            &[
                comment("s1", "e1", "a"),
                other_source,
                comment("s2", "e1", "c"),
            ],
        )
        .unwrap();
        assert_eq!(n, 3);
    }

    #[test]
    fn session_lifecycle_and_cascade_delete() {
        let mut c = open_in_memory().unwrap();
        create_session(&c, &session("s1")).unwrap();
        update_session(
            &c,
            "s1",
            &SessionPatch {
                status: Some("DISCONNECTED".into()),
                ended_at: Some("t".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let s = latest_session(&c).unwrap().unwrap();
        assert_eq!(s.status, "DISCONNECTED");
        assert_eq!(s.ended_at.as_deref(), Some("t"));
        ingest_comments(&mut c, &[comment("s1", "e1", "hi")]).unwrap();
        delete_session(&c, "s1").unwrap();
        assert!(latest_session(&c).unwrap().is_none());
        let left: i64 = c
            .query_row("SELECT COUNT(*) FROM live_comments", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn comment_for_unknown_session_is_rejected() {
        let mut c = open_in_memory().unwrap();
        assert!(ingest_comments(&mut c, &[comment("nope", "e1", "hi")]).is_err());
    }
}

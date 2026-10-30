//! Reply suggestions for the seller to review. The app has no way to send a reply to TikTok, so
//! `SENT` is reserved and can never be set here: copying a reply is recorded as `COPIED` only.

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};

pub const MAX_REPLY_CHARS: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReplyDto {
    pub id: String,
    pub session_id: String,
    pub event_id: String,
    pub source: String,
    pub suggested_text: String,
    pub model_provider: Option<String>,
    pub model_name: Option<String>,
    pub status: String,
    pub approved_by_user: bool,
    pub created_at: String,
    pub updated_at: String,
}

fn bad(msg: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(msg.to_string())
}

fn clip(text: &str) -> String {
    text.trim().chars().take(MAX_REPLY_CHARS).collect()
}

/// Create a suggestion. It always starts as DRAFT and not approved.
pub fn reply_create(conn: &Connection, r: &ReplyDto) -> Result<()> {
    let text = clip(&r.suggested_text);
    if text.is_empty() || r.id.is_empty() || r.event_id.is_empty() {
        return Err(bad("reply"));
    }
    conn.execute(
        "INSERT INTO live_reply_suggestions
           (id, session_id, event_id, source, suggested_text, model_provider, model_name,
            status, approved_by_user, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,'DRAFT',0,?8,?8)",
        params![
            r.id,
            r.session_id,
            r.event_id,
            r.source,
            text,
            r.model_provider,
            r.model_name,
            r.created_at
        ],
    )?;
    Ok(())
}

pub fn reply_list(conn: &Connection, session_id: &str) -> Result<Vec<ReplyDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, event_id, source, suggested_text, model_provider, model_name,
                status, approved_by_user, created_at, updated_at
         FROM live_reply_suggestions WHERE session_id = ?1 ORDER BY created_at, rowid",
    )?;
    let rows = stmt.query_map([session_id], |r| {
        Ok(ReplyDto {
            id: r.get(0)?,
            session_id: r.get(1)?,
            event_id: r.get(2)?,
            source: r.get(3)?,
            suggested_text: r.get(4)?,
            model_provider: r.get(5)?,
            model_name: r.get(6)?,
            status: r.get(7)?,
            approved_by_user: r.get::<_, i64>(8)? != 0,
            created_at: r.get(9)?,
            updated_at: r.get(10)?,
        })
    })?;
    rows.collect()
}

/// Seller actions: edit the text and/or mark COPIED or REJECTED. Editing a copied reply makes it
/// a DRAFT again (the new text has not been copied). SENT is not an allowed target.
pub fn reply_update(
    conn: &Connection,
    id: &str,
    text: Option<&str>,
    status: Option<&str>,
    now: &str,
) -> Result<bool> {
    if let Some(s) = status {
        if !matches!(s, "DRAFT" | "COPIED" | "REJECTED") {
            return Err(bad("status"));
        }
    }
    let cur: Option<String> = conn
        .query_row(
            "SELECT status FROM live_reply_suggestions WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(cur) = cur else { return Ok(false) };
    if cur == "SENT" {
        return Err(bad("sent is final"));
    }
    let new_text = match text {
        Some(t) => {
            let t = clip(t);
            if t.is_empty() {
                return Err(bad("empty"));
            }
            Some(t)
        }
        None => None,
    };
    let next_status = match (status, &new_text) {
        (Some(s), _) => s.to_string(),
        (None, Some(_)) => "DRAFT".to_string(),
        (None, None) => cur.clone(),
    };
    // "Approved" means the seller took this exact text: copied it.
    let approved = next_status == "COPIED";
    conn.execute(
        "UPDATE live_reply_suggestions SET
           suggested_text = COALESCE(?2, suggested_text), status = ?3,
           approved_by_user = ?4, updated_at = ?5
         WHERE id = ?1",
        params![id, new_text, next_status, approved as i64, now],
    )?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::live::{create_session, NewSession};

    fn setup() -> Connection {
        let c = open_in_memory().unwrap();
        create_session(
            &c,
            &NewSession {
                id: "s1".into(),
                live_url: None,
                username: None,
                provider_type: "manual".into(),
                status: "MANUAL".into(),
            },
        )
        .unwrap();
        c
    }

    fn reply(id: &str) -> ReplyDto {
        ReplyDto {
            id: id.into(),
            session_id: "s1".into(),
            event_id: "e1".into(),
            source: "MANUAL".into(),
            suggested_text: "  今天下單隔天出貨喔！  ".into(),
            model_provider: Some("claude".into()),
            model_name: Some("m".into()),
            // Whatever the caller says, a new suggestion starts as an unapproved draft.
            status: "SENT".into(),
            approved_by_user: true,
            created_at: "2026-10-30T02:00:00Z".into(),
            updated_at: "x".into(),
        }
    }

    #[test]
    fn new_suggestions_are_unapproved_drafts() {
        let c = setup();
        reply_create(&c, &reply("r1")).unwrap();
        let got = reply_list(&c, "s1").unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].status, "DRAFT");
        assert!(!got[0].approved_by_user);
        assert_eq!(got[0].suggested_text, "今天下單隔天出貨喔！");
        let mut empty = reply("r2");
        empty.suggested_text = "   ".into();
        assert!(reply_create(&c, &empty).is_err());
    }

    #[test]
    fn copy_is_not_sent_and_editing_resets_it() {
        let c = setup();
        reply_create(&c, &reply("r1")).unwrap();
        assert!(reply_update(&c, "r1", None, Some("COPIED"), "t1").unwrap());
        let r = &reply_list(&c, "s1").unwrap()[0];
        assert_eq!((r.status.as_str(), r.approved_by_user), ("COPIED", true));
        assert!(r.status != "SENT");
        // New text has not been copied yet.
        reply_update(&c, "r1", Some("改過的內容"), None, "t2").unwrap();
        let r = &reply_list(&c, "s1").unwrap()[0];
        assert_eq!((r.status.as_str(), r.approved_by_user), ("DRAFT", false));
        assert_eq!(r.suggested_text, "改過的內容");
        reply_update(&c, "r1", None, Some("REJECTED"), "t3").unwrap();
        assert_eq!(reply_list(&c, "s1").unwrap()[0].status, "REJECTED");
    }

    #[test]
    fn sent_can_never_be_set_from_the_app() {
        let c = setup();
        reply_create(&c, &reply("r1")).unwrap();
        assert!(reply_update(&c, "r1", None, Some("SENT"), "t").is_err());
        assert!(reply_update(&c, "r1", Some(" "), None, "t").is_err());
        assert!(!reply_update(&c, "missing", None, Some("COPIED"), "t").unwrap());
    }

    #[test]
    fn long_text_is_clipped_and_session_delete_cascades() {
        let c = setup();
        let mut r = reply("r1");
        r.suggested_text = "啊".repeat(2000);
        reply_create(&c, &r).unwrap();
        assert_eq!(
            reply_list(&c, "s1").unwrap()[0]
                .suggested_text
                .chars()
                .count(),
            MAX_REPLY_CHARS
        );
        crate::live::delete_session(&c, "s1").unwrap();
        assert!(reply_list(&c, "s1").unwrap().is_empty());
    }
}

//! One product photo per SKU (not per unit — units of a SKU are the same product), set when
//! stock is received and shown again in Stock, Receive and the "Thanh Toán" checkout cart.
//! Stored as a data: URL straight in SQLite: the client downscales the picture to a small JPEG
//! before it ever reaches here, so a phone reading it over the share link gets the same bytes
//! through the ordinary JSON command round trip as every other command — no file server and no
//! path to keep in sync across Mac, Windows and a phone.

use rusqlite::{params, Connection, OptionalExtension, Result};

/// ~500KB of image bytes once base64-decoded; a downscaled JPEG thumbnail is a small fraction
/// of this, so a legitimate photo never gets close.
const MAX_LEN: usize = 700_000;

fn bad(msg: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(msg.to_string())
}

pub fn set(conn: &Connection, sku: &str, data_url: &str, now: &str) -> Result<()> {
    if sku.is_empty() || sku.chars().count() > 30 {
        return Err(bad("sku"));
    }
    if !data_url.starts_with("data:image/") || data_url.len() > MAX_LEN {
        return Err(bad("data_url"));
    }
    conn.execute(
        "INSERT INTO sku_images (sku, data_url, updated_at) VALUES (?1,?2,?3)
         ON CONFLICT(sku) DO UPDATE SET data_url=excluded.data_url, updated_at=excluded.updated_at",
        params![sku, data_url, now],
    )?;
    Ok(())
}

pub fn get(conn: &Connection, sku: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT data_url FROM sku_images WHERE sku = ?1",
        [sku],
        |r| r.get(0),
    )
    .optional()
}

pub fn delete(conn: &Connection, sku: &str) -> Result<()> {
    conn.execute("DELETE FROM sku_images WHERE sku = ?1", [sku])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn sets_and_gets() {
        let conn = open_in_memory().unwrap();
        set(
            &conn,
            "A12",
            "data:image/jpeg;base64,abc",
            "2026-01-01T00:00:00Z",
        )
        .unwrap();
        assert_eq!(
            get(&conn, "A12").unwrap(),
            Some("data:image/jpeg;base64,abc".to_string())
        );
    }

    #[test]
    fn missing_sku_is_none() {
        let conn = open_in_memory().unwrap();
        assert_eq!(get(&conn, "NOPE").unwrap(), None);
    }

    #[test]
    fn rejects_non_data_url() {
        let conn = open_in_memory().unwrap();
        assert!(set(
            &conn,
            "A12",
            "https://evil.example/x.jpg",
            "2026-01-01T00:00:00Z"
        )
        .is_err());
    }

    #[test]
    fn upserts_on_same_sku() {
        let conn = open_in_memory().unwrap();
        set(
            &conn,
            "A12",
            "data:image/jpeg;base64,one",
            "2026-01-01T00:00:00Z",
        )
        .unwrap();
        set(
            &conn,
            "A12",
            "data:image/jpeg;base64,two",
            "2026-01-02T00:00:00Z",
        )
        .unwrap();
        assert_eq!(
            get(&conn, "A12").unwrap(),
            Some("data:image/jpeg;base64,two".to_string())
        );
    }

    #[test]
    fn deletes() {
        let conn = open_in_memory().unwrap();
        set(
            &conn,
            "A12",
            "data:image/jpeg;base64,abc",
            "2026-01-01T00:00:00Z",
        )
        .unwrap();
        delete(&conn, "A12").unwrap();
        assert_eq!(get(&conn, "A12").unwrap(), None);
    }
}

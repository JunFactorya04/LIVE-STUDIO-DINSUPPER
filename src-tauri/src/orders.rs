//! Shop catalog and order drafts. Drafts are only ever DRAFT / NEEDS_REVIEW until the seller
//! confirms; nothing here talks to a shipping service.

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};

pub const STATUSES: &[&str] = &["DRAFT", "NEEDS_REVIEW", "CONFIRMED", "CANCELLED"];
pub const MAX_QUANTITY: i64 = 999;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogItemDto {
    pub sku: String,
    pub name: String,
    pub price: Option<f64>,
    #[serde(default)]
    pub colors: Vec<String>,
    #[serde(default)]
    pub sizes: Vec<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    /// Free-form fields for shops outside clothing (expiry date, volume, brand...): the seller
    /// names the key, so this works for any kind of shop without a fixed schema.
    #[serde(default)]
    pub attrs: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceDto {
    pub event_id: String,
    pub field: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrderDraftDto {
    pub id: String,
    pub session_id: String,
    pub platform_user_id: Option<String>,
    pub username: Option<String>,
    pub sku: Option<String>,
    pub color: Option<String>,
    pub size: Option<String>,
    pub quantity: Option<i64>,
    pub confidence: f64,
    pub status: String,
    #[serde(default)]
    pub reasons: Vec<String>,
    #[serde(default)]
    pub evidence: Vec<EvidenceDto>,
    pub created_at: String,
    pub updated_at: String,
}

fn bad(msg: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(msg.to_string())
}

fn list_json(v: &[String]) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "[]".into())
}

fn json_list(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}

fn clean(list: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for s in list {
        let t = s.trim();
        if !t.is_empty() && !out.iter().any(|x| x == t) {
            out.push(t.chars().take(64).collect());
        }
    }
    out
}

// ---- catalog ----

/// At most this many custom attrs per item, keys/values each capped like the other free-text
/// fields here: generous for "hạn dùng", "dung tích", "thương hiệu"... but still bounded.
const MAX_ATTRS: usize = 24;

fn clean_attrs(
    attrs: &std::collections::BTreeMap<String, String>,
) -> std::collections::BTreeMap<String, String> {
    attrs
        .iter()
        .filter_map(|(k, v)| {
            let key: String = k.trim().chars().take(40).collect();
            let val: String = v.trim().chars().take(120).collect();
            if key.is_empty() {
                None
            } else {
                Some((key, val))
            }
        })
        .take(MAX_ATTRS)
        .collect()
}

pub fn catalog_upsert(conn: &Connection, item: &CatalogItemDto) -> Result<()> {
    let sku = item.sku.trim();
    let name = item.name.trim();
    if sku.is_empty() || sku.chars().count() > 64 {
        return Err(bad("sku"));
    }
    if name.is_empty() {
        return Err(bad("name"));
    }
    if item.price.is_some_and(|p| !p.is_finite() || p < 0.0) {
        return Err(bad("price"));
    }
    let attrs = clean_attrs(&item.attrs);
    let attrs_json = serde_json::to_string(&attrs).unwrap_or_else(|_| "{}".into());
    conn.execute(
        "INSERT INTO catalog_items (sku, name, price, colors, sizes, aliases, attrs, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(sku) DO UPDATE SET
           name = excluded.name, price = excluded.price, colors = excluded.colors,
           sizes = excluded.sizes, aliases = excluded.aliases, attrs = excluded.attrs,
           updated_at = excluded.updated_at",
        params![
            sku,
            name,
            item.price,
            list_json(&clean(&item.colors)),
            list_json(&clean(&item.sizes)),
            list_json(&clean(&item.aliases)),
            attrs_json,
        ],
    )?;
    Ok(())
}

pub fn catalog_list(conn: &Connection) -> Result<Vec<CatalogItemDto>> {
    let mut stmt = conn.prepare(
        "SELECT sku, name, price, colors, sizes, aliases, attrs FROM catalog_items ORDER BY sku",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(CatalogItemDto {
            sku: r.get(0)?,
            name: r.get(1)?,
            price: r.get(2)?,
            colors: json_list(&r.get::<_, String>(3)?),
            sizes: json_list(&r.get::<_, String>(4)?),
            aliases: json_list(&r.get::<_, String>(5)?),
            attrs: serde_json::from_str(&r.get::<_, String>(6)?).unwrap_or_default(),
        })
    })?;
    rows.collect()
}

pub fn catalog_delete(conn: &Connection, sku: &str) -> Result<usize> {
    conn.execute("DELETE FROM catalog_items WHERE sku = ?1", [sku])
}

// ---- order drafts ----

pub fn order_save(conn: &mut Connection, d: &OrderDraftDto) -> Result<()> {
    if !STATUSES.contains(&d.status.as_str()) {
        return Err(bad("status"));
    }
    if d.quantity.is_some_and(|q| !(1..=MAX_QUANTITY).contains(&q)) {
        return Err(bad("quantity"));
    }
    if !(0.0..=1.0).contains(&d.confidence) {
        return Err(bad("confidence"));
    }
    let variant = serde_json::json!({ "color": d.color, "size": d.size }).to_string();
    let reasons = d.reasons.join(",");
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO live_order_drafts
           (id, session_id, platform_user_id, username, sku, variant_json, quantity,
            confidence, status, review_reason, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
         ON CONFLICT(id) DO UPDATE SET
           platform_user_id = excluded.platform_user_id, username = excluded.username,
           sku = excluded.sku, variant_json = excluded.variant_json, quantity = excluded.quantity,
           confidence = excluded.confidence, status = excluded.status,
           review_reason = excluded.review_reason, updated_at = excluded.updated_at",
        params![
            d.id,
            d.session_id,
            d.platform_user_id,
            d.username,
            d.sku,
            variant,
            d.quantity,
            d.confidence,
            d.status,
            if reasons.is_empty() {
                None
            } else {
                Some(reasons)
            },
            d.created_at,
            d.updated_at
        ],
    )?;
    tx.execute(
        "DELETE FROM live_order_evidence WHERE order_draft_id = ?1",
        [&d.id],
    )?;
    for e in d.evidence.iter().take(50) {
        let text: String = e.text.chars().take(MAX_EVIDENCE_CHARS).collect();
        tx.execute(
            "INSERT INTO live_order_evidence (order_draft_id, event_id, field_name, evidence_text)
             VALUES (?1,?2,?3,?4)",
            params![d.id, e.event_id, e.field, text],
        )?;
    }
    tx.commit()
}

const MAX_EVIDENCE_CHARS: usize = 500;

pub fn order_list(conn: &Connection, session_id: &str) -> Result<Vec<OrderDraftDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, platform_user_id, username, sku, variant_json, quantity,
                confidence, status, review_reason, created_at, updated_at
         FROM live_order_drafts WHERE session_id = ?1 ORDER BY created_at, rowid",
    )?;
    let mut drafts: Vec<OrderDraftDto> = stmt
        .query_map([session_id], |r| {
            let variant: serde_json::Value =
                serde_json::from_str(&r.get::<_, String>(5)?).unwrap_or_default();
            let reasons: Option<String> = r.get(9)?;
            Ok(OrderDraftDto {
                id: r.get(0)?,
                session_id: r.get(1)?,
                platform_user_id: r.get(2)?,
                username: r.get(3)?,
                sku: r.get(4)?,
                color: variant
                    .get("color")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                size: variant
                    .get("size")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                quantity: r.get(6)?,
                confidence: r.get(7)?,
                status: r.get(8)?,
                reasons: reasons
                    .map(|s| {
                        s.split(',')
                            .filter(|x| !x.is_empty())
                            .map(String::from)
                            .collect()
                    })
                    .unwrap_or_default(),
                evidence: Vec::new(),
                created_at: r.get(10)?,
                updated_at: r.get(11)?,
            })
        })?
        .collect::<Result<_>>()?;

    let mut ev = conn.prepare(
        "SELECT event_id, field_name, evidence_text FROM live_order_evidence
         WHERE order_draft_id = ?1 ORDER BY id",
    )?;
    for d in drafts.iter_mut() {
        d.evidence = ev
            .query_map([&d.id], |r| {
                Ok(EvidenceDto {
                    event_id: r.get(0)?,
                    field: r.get(1)?,
                    text: r.get(2)?,
                })
            })?
            .collect::<Result<_>>()?;
    }
    Ok(drafts)
}

/// Seller decision. CONFIRMED is only allowed from DRAFT (not from NEEDS_REVIEW), CANCELLED from
/// anything not already cancelled; terminal drafts never change again.
pub fn order_set_status(conn: &Connection, id: &str, status: &str, now: &str) -> Result<bool> {
    let current: Option<String> = conn
        .query_row(
            "SELECT status FROM live_order_drafts WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(current) = current else {
        return Ok(false);
    };
    let allowed = match (current.as_str(), status) {
        ("DRAFT", "CONFIRMED") => true,
        ("DRAFT" | "NEEDS_REVIEW" | "CONFIRMED", "CANCELLED") => true,
        _ => false,
    };
    if !allowed {
        return Err(bad("transition"));
    }
    conn.execute(
        "UPDATE live_order_drafts SET status = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, status, now],
    )?;
    if status == "CONFIRMED" {
        // Remember the buyer's TikTok ID for the shipping form (ID only, nothing generated).
        let user: Option<String> = conn
            .query_row(
                "SELECT username FROM live_order_drafts WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        if let Some(u) = user {
            crate::ship::remember_buyer(conn, &u, now)?;
        }
    }
    Ok(true)
}

// ---- printed slip image (for post-session reconciliation) ----

/// A base64 data: URL is already ~33% larger than the PNG it carries; cap well above what a
/// small thermal-printer sticker needs so a stray huge image cannot bloat the database.
const MAX_SLIP_IMAGE_CHARS: usize = 400_000;

/// Remember the exact bitmap that was sent to the printer for this order draft, as a PNG. Called
/// right after a successful print; a failure here never blocks or un-does the print itself.
pub fn slip_save(conn: &Connection, order_draft_id: &str, image_png: &str) -> Result<()> {
    if order_draft_id.trim().is_empty() {
        return Err(bad("order_draft_id"));
    }
    if image_png.is_empty() || image_png.len() > MAX_SLIP_IMAGE_CHARS {
        return Err(bad("image"));
    }
    conn.execute(
        "INSERT INTO order_slips (order_draft_id, image_png, printed_at)
         VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(order_draft_id) DO UPDATE SET
           image_png = excluded.image_png, printed_at = excluded.printed_at",
        params![order_draft_id, image_png],
    )?;
    Ok(())
}

/// The image itself, fetched only when the seller opens one order to look at it.
pub fn slip_image(conn: &Connection, order_draft_id: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT image_png FROM order_slips WHERE order_draft_id = ?1",
        [order_draft_id],
        |r| r.get(0),
    )
    .optional()
}

/// Which drafts of a session have a printed slip on file, for a lightweight "📷" marker on each
/// order row without pulling every image over just to show that.
pub fn slips_printed_for_session(conn: &Connection, session_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT s.order_draft_id FROM order_slips s
         JOIN live_order_drafts d ON d.id = s.order_draft_id
         WHERE d.session_id = ?1",
    )?;
    let rows = stmt.query_map([session_id], |r| r.get::<_, String>(0))?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::live::{create_session, NewSession};

    fn session(c: &Connection) {
        create_session(
            c,
            &NewSession {
                id: "s1".into(),
                live_url: None,
                username: None,
                provider_type: "manual".into(),
                status: "MANUAL".into(),
            },
        )
        .unwrap();
    }

    fn item(sku: &str) -> CatalogItemDto {
        CatalogItemDto {
            sku: sku.into(),
            name: "黑色連帽衫".into(),
            price: Some(790.0),
            colors: vec!["黑色".into(), " 黑色 ".into(), "白色".into()],
            sizes: vec!["M".into(), "L".into()],
            aliases: vec![],
            attrs: std::collections::BTreeMap::new(),
        }
    }

    fn draft(id: &str) -> OrderDraftDto {
        OrderDraftDto {
            id: id.into(),
            session_id: "s1".into(),
            platform_user_id: None,
            username: Some("amy".into()),
            sku: Some("A12".into()),
            color: Some("黑色".into()),
            size: Some("M".into()),
            quantity: Some(2),
            confidence: 0.8,
            status: "DRAFT".into(),
            reasons: vec![],
            evidence: vec![EvidenceDto {
                event_id: "e1".into(),
                field: "sku".into(),
                text: "A12".into(),
            }],
            created_at: "2026-10-30T02:00:00Z".into(),
            updated_at: "2026-10-30T02:00:00Z".into(),
        }
    }

    #[test]
    fn catalog_upsert_list_delete_and_dedupe_variants() {
        let c = open_in_memory().unwrap();
        catalog_upsert(&c, &item("A12")).unwrap();
        let mut changed = item("A12");
        changed.name = "新名稱".into();
        catalog_upsert(&c, &changed).unwrap();
        let list = catalog_list(&c).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "新名稱");
        assert_eq!(list[0].colors, vec!["黑色", "白色"]);
        assert_eq!(catalog_delete(&c, "A12").unwrap(), 1);
        assert!(catalog_list(&c).unwrap().is_empty());
    }

    #[test]
    fn catalog_attrs_round_trip_and_trim_blank_keys() {
        let c = open_in_memory().unwrap();
        let mut it = item("CO1");
        it.attrs = std::collections::BTreeMap::from([
            ("Hạn dùng".into(), "2026-12-01".into()),
            ("  ".into(), "dropped: blank key".into()),
            ("Dung tích".into(), " 50ml ".into()),
        ]);
        catalog_upsert(&c, &it).unwrap();
        let saved = &catalog_list(&c).unwrap()[0];
        assert_eq!(saved.attrs.len(), 2);
        assert_eq!(
            saved.attrs.get("Hạn dùng").map(String::as_str),
            Some("2026-12-01")
        );
        assert_eq!(
            saved.attrs.get("Dung tích").map(String::as_str),
            Some("50ml")
        );
    }

    #[test]
    fn catalog_rejects_bad_input() {
        let c = open_in_memory().unwrap();
        assert!(catalog_upsert(&c, &item("  ")).is_err());
        let mut no_name = item("A1");
        no_name.name = " ".into();
        assert!(catalog_upsert(&c, &no_name).is_err());
        let mut neg = item("A1");
        neg.price = Some(-1.0);
        assert!(catalog_upsert(&c, &neg).is_err());
    }

    #[test]
    fn draft_roundtrip_with_evidence_and_reasons() {
        let mut c = open_in_memory().unwrap();
        session(&c);
        let mut d = draft("d1");
        d.status = "NEEDS_REVIEW".into();
        d.reasons = vec!["MISSING_SIZE".into(), "CONFLICT_COLOR".into()];
        order_save(&mut c, &d).unwrap();
        let back = order_list(&c, "s1").unwrap();
        assert_eq!(back, vec![d.clone()]);

        // Saving again replaces evidence instead of duplicating it.
        order_save(&mut c, &d).unwrap();
        assert_eq!(order_list(&c, "s1").unwrap()[0].evidence.len(), 1);
    }

    #[test]
    fn printed_slip_image_is_saved_and_listed_per_session() {
        let mut c = open_in_memory().unwrap();
        session(&c);
        order_save(&mut c, &draft("d1")).unwrap();
        order_save(&mut c, &draft("d2")).unwrap();
        assert!(slip_image(&c, "d1").unwrap().is_none());
        slip_save(&c, "d1", "fake-png-bytes-1").unwrap();
        assert_eq!(
            slip_image(&c, "d1").unwrap().as_deref(),
            Some("fake-png-bytes-1")
        );
        assert_eq!(
            slips_printed_for_session(&c, "s1").unwrap(),
            vec!["d1".to_string()]
        );
        // Printing again (re-print) replaces the stored image rather than erroring.
        slip_save(&c, "d1", "fake-png-bytes-2").unwrap();
        assert_eq!(
            slip_image(&c, "d1").unwrap().as_deref(),
            Some("fake-png-bytes-2")
        );
        assert_eq!(slips_printed_for_session(&c, "s1").unwrap().len(), 1);
        assert!(slip_save(&c, "", "x").is_err());
        assert!(slip_save(&c, "d1", "").is_err());
    }

    #[test]
    fn draft_validation_and_cascade() {
        let mut c = open_in_memory().unwrap();
        session(&c);
        let mut bad_status = draft("d1");
        bad_status.status = "SHIPPED".into();
        assert!(order_save(&mut c, &bad_status).is_err());
        let mut bad_qty = draft("d2");
        bad_qty.quantity = Some(0);
        assert!(order_save(&mut c, &bad_qty).is_err());
        let mut no_session = draft("d3");
        no_session.session_id = "missing".into();
        assert!(order_save(&mut c, &no_session).is_err());

        order_save(&mut c, &draft("d4")).unwrap();
        crate::live::delete_session(&c, "s1").unwrap();
        let left: i64 = c
            .query_row("SELECT COUNT(*) FROM live_order_evidence", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn status_transitions_follow_seller_rules() {
        let mut c = open_in_memory().unwrap();
        session(&c);
        order_save(&mut c, &draft("ok")).unwrap();
        let mut review = draft("review");
        review.status = "NEEDS_REVIEW".into();
        order_save(&mut c, &review).unwrap();

        // A draft that needs review can never be confirmed directly.
        assert!(order_set_status(&c, "review", "CONFIRMED", "t").is_err());
        assert!(order_set_status(&c, "ok", "CONFIRMED", "t").unwrap());
        // Confirmed can still be cancelled, cancelled is final.
        assert!(order_set_status(&c, "ok", "CANCELLED", "t").unwrap());
        assert!(order_set_status(&c, "ok", "CONFIRMED", "t").is_err());
        assert!(!order_set_status(&c, "nope", "CANCELLED", "t").unwrap());
    }
}

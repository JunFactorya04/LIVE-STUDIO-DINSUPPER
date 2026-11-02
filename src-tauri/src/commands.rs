//! Tauri commands. Thin wrappers: all logic lives in `live.rs` and `secrets.rs` (tested there).

use crate::live::{self, CommentDto, NewSession, SessionDto, SessionPatch};
use crate::secrets::{self, KeyringStore, SecretStore};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;

pub struct DbState(pub Mutex<Connection>);
pub struct SecretState(pub Box<dyn SecretStore>);

impl Default for SecretState {
    fn default() -> Self {
        SecretState(Box::new(KeyringStore))
    }
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn db<'a>(s: &'a State<'_, DbState>) -> Result<std::sync::MutexGuard<'a, Connection>, String> {
    s.0.lock().map_err(|_| "database lock poisoned".to_string())
}

/// Best-effort audit entry: it records codes only, and a failure never blocks the action.
fn log(state: &State<'_, DbState>, action: &str, detail: &str) {
    if let Ok(conn) = state.0.lock() {
        let _ = crate::data::audit(&conn, action, detail);
    }
}

#[tauri::command]
pub fn live_create_session(state: State<'_, DbState>, session: NewSession) -> Result<(), String> {
    live::create_session(&*db(&state)?, &session).map_err(err)?;
    log(
        &state,
        "SESSION_START",
        &format!("provider={}", session.provider_type),
    );
    Ok(())
}

#[tauri::command]
pub fn live_update_session(
    state: State<'_, DbState>,
    id: String,
    patch: SessionPatch,
) -> Result<(), String> {
    live::update_session(&*db(&state)?, &id, &patch).map_err(err)
}

#[tauri::command]
pub fn live_latest_session(state: State<'_, DbState>) -> Result<Option<SessionDto>, String> {
    live::latest_session(&*db(&state)?).map_err(err)
}

#[tauri::command]
pub fn live_ingest_comments(
    state: State<'_, DbState>,
    comments: Vec<CommentDto>,
) -> Result<usize, String> {
    live::ingest_comments(&mut *db(&state)?, &comments).map_err(err)
}

#[tauri::command]
pub fn live_list_comments(
    state: State<'_, DbState>,
    session_id: String,
    limit: usize,
) -> Result<Vec<CommentDto>, String> {
    live::list_comments(&*db(&state)?, &session_id, limit.min(live::MAX_BATCH)).map_err(err)
}

#[tauri::command]
pub fn live_delete_comments(
    state: State<'_, DbState>,
    session_id: String,
) -> Result<usize, String> {
    live::delete_comments(&*db(&state)?, &session_id).map_err(err)
}

#[tauri::command]
pub fn live_delete_session(state: State<'_, DbState>, session_id: String) -> Result<usize, String> {
    let n = live::delete_session(&*db(&state)?, &session_id).map_err(err)?;
    log(&state, "SESSION_DELETE", &format!("rows={n}"));
    Ok(n)
}

// Secrets: write, check, remove. There is intentionally no command that returns a key.

#[tauri::command]
pub fn secret_set(
    state: State<'_, SecretState>,
    dbs: State<'_, DbState>,
    slot: String,
    value: String,
) -> Result<(), String> {
    secrets::set_secret(state.0.as_ref(), &slot, &value)?;
    // Only the slot name is logged, never the value.
    log(&dbs, "SECRET_SET", &format!("slot={slot}"));
    Ok(())
}

#[tauri::command]
pub fn secret_exists(state: State<'_, SecretState>, slot: String) -> Result<bool, String> {
    secrets::secret_exists(state.0.as_ref(), &slot)
}

#[tauri::command]
pub fn secret_remove(
    state: State<'_, SecretState>,
    dbs: State<'_, DbState>,
    slot: String,
) -> Result<(), String> {
    secrets::remove_secret(state.0.as_ref(), &slot)?;
    log(&dbs, "SECRET_REMOVE", &format!("slot={slot}"));
    Ok(())
}

// ---- Euler Stream comment source (unofficial third-party service) ----

use crate::euler::{self, EulerOut};
use tauri::{AppHandle, Emitter};

/// The running connection, if any. Starting a new one stops the old one.
#[derive(Default)]
pub struct EulerState(pub Mutex<Option<tauri::async_runtime::JoinHandle<()>>>);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EulerEnvelope {
    session_id: String,
    #[serde(flatten)]
    out: EulerOut,
}

fn emit_euler(app: &AppHandle, session_id: &str, out: EulerOut) {
    let _ = app.emit(
        "euler-event",
        EulerEnvelope {
            session_id: session_id.to_string(),
            out,
        },
    );
}

fn stop_euler(state: &EulerState) {
    if let Ok(mut slot) = state.0.lock() {
        if let Some(handle) = slot.take() {
            handle.abort();
        }
    }
}

/// Start receiving comments for `unique_id`. The key is read from the OS keychain here and
/// never leaves Rust. Progress is reported through `euler-event` events, not the return value.
#[tauri::command]
pub fn euler_connect(
    app: AppHandle,
    secrets: State<'_, SecretState>,
    euler: State<'_, EulerState>,
    dbs: State<'_, DbState>,
    session_id: String,
    unique_id: String,
) -> Result<(), String> {
    stop_euler(&euler);
    log(&dbs, "EULER_CONNECT", "");

    let Some(unique_id) = euler::normalize_unique_id(&unique_id) else {
        emit_euler(
            &app,
            &session_id,
            EulerOut::Status {
                status: "ERROR",
                code: None,
                reason: Some("INVALID_OPTIONS"),
            },
        );
        return Ok(());
    };
    let key = secrets
        .0
        .get("connector")
        .map_err(|_| "keychain unavailable".to_string())?;
    let Some(key) = key else {
        emit_euler(
            &app,
            &session_id,
            EulerOut::Status {
                status: "UNAVAILABLE",
                code: None,
                reason: Some("NO_KEY"),
            },
        );
        return Ok(());
    };

    let base = std::env::var("EULER_WS_URL").unwrap_or_else(|_| euler::DEFAULT_WS_URL.to_string());
    let handle = tauri::async_runtime::spawn(async move {
        let app2 = app.clone();
        let sid = session_id.clone();
        euler::run_connection(&base, &unique_id, &key, &move |out| {
            emit_euler(&app2, &sid, out)
        })
        .await;
    });
    if let Ok(mut slot) = euler.0.lock() {
        *slot = Some(handle);
    }
    Ok(())
}

#[tauri::command]
pub fn euler_disconnect(euler: State<'_, EulerState>, dbs: State<'_, DbState>) {
    stop_euler(&euler);
    log(&dbs, "EULER_DISCONNECT", "");
}

// ---- Catalog and order drafts ----

use crate::orders::{self, CatalogItemDto, OrderDraftDto};

#[tauri::command]
pub fn catalog_list(state: State<'_, DbState>) -> Result<Vec<CatalogItemDto>, String> {
    orders::catalog_list(&*db(&state)?).map_err(err)
}

#[tauri::command]
pub fn catalog_upsert(state: State<'_, DbState>, item: CatalogItemDto) -> Result<(), String> {
    orders::catalog_upsert(&*db(&state)?, &item).map_err(err)
}

#[tauri::command]
pub fn catalog_delete(state: State<'_, DbState>, sku: String) -> Result<usize, String> {
    orders::catalog_delete(&*db(&state)?, &sku).map_err(err)
}

#[tauri::command]
pub fn order_save(state: State<'_, DbState>, draft: OrderDraftDto) -> Result<(), String> {
    orders::order_save(&mut *db(&state)?, &draft).map_err(err)
}

#[tauri::command]
pub fn order_list(
    state: State<'_, DbState>,
    session_id: String,
) -> Result<Vec<OrderDraftDto>, String> {
    orders::order_list(&*db(&state)?, &session_id).map_err(err)
}

#[tauri::command]
pub fn order_set_status(
    state: State<'_, DbState>,
    id: String,
    status: String,
    now: String,
) -> Result<bool, String> {
    let changed = orders::order_set_status(&*db(&state)?, &id, &status, &now).map_err(err)?;
    if changed {
        match status.as_str() {
            "CONFIRMED" => log(&state, "ORDER_CONFIRMED", ""),
            "CANCELLED" => log(&state, "ORDER_CANCELLED", ""),
            _ => {}
        }
    }
    Ok(changed)
}

// ---- AI providers (the seller's own key, read from the keychain here in Rust) ----

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderInfo {
    pub id: &'static str,
    pub default_model: &'static str,
}

#[tauri::command]
pub fn ai_providers() -> Vec<AiProviderInfo> {
    crate::ai::PROVIDERS
        .iter()
        .map(|p| AiProviderInfo {
            id: p.id,
            default_model: p.default_model,
        })
        .collect()
}

/// Returns the answer text, or one of the short codes of `ai::AiError` (never the key or a body).
#[tauri::command]
pub async fn ai_complete(
    state: State<'_, SecretState>,
    dbs: State<'_, DbState>,
    provider: String,
    model: Option<String>,
    system: String,
    prompt: String,
    max_tokens: Option<u32>,
) -> Result<String, String> {
    let result = crate::ai::complete(
        &*state.0,
        &provider,
        model.as_deref(),
        &system,
        &prompt,
        max_tokens.unwrap_or(256),
        None,
    )
    .await;
    // Provider and outcome only: the prompt, the answer and the key are never logged.
    match &result {
        Ok(_) => log(&dbs, "AI_CALL_OK", &format!("provider={provider}")),
        Err(e) => log(
            &dbs,
            "AI_CALL_ERROR",
            &format!("provider={provider} code={}", e.code()),
        ),
    }
    result.map_err(|e| e.code().to_string())
}

#[tauri::command]
pub fn live_set_intents(
    state: State<'_, DbState>,
    session_id: String,
    items: Vec<live::IntentDto>,
) -> Result<usize, String> {
    live::set_intents(&mut *db(&state)?, &session_id, &items).map_err(err)
}

// ---- Reply suggestions (COPIED is never SENT: the app cannot send replies) ----

use crate::replies::{self, ReplyDto};

#[tauri::command]
pub fn reply_create(state: State<'_, DbState>, reply: ReplyDto) -> Result<(), String> {
    replies::reply_create(&*db(&state)?, &reply).map_err(err)
}

#[tauri::command]
pub fn reply_list(state: State<'_, DbState>, session_id: String) -> Result<Vec<ReplyDto>, String> {
    replies::reply_list(&*db(&state)?, &session_id).map_err(err)
}

#[tauri::command]
pub fn reply_update(
    state: State<'_, DbState>,
    id: String,
    text: Option<String>,
    status: Option<String>,
    now: String,
) -> Result<bool, String> {
    let changed =
        replies::reply_update(&*db(&state)?, &id, text.as_deref(), status.as_deref(), &now)
            .map_err(err)?;
    if changed {
        match status.as_deref() {
            Some("COPIED") => log(&state, "REPLY_COPIED", ""),
            Some("REJECTED") => log(&state, "REPLY_REJECTED", ""),
            _ => {}
        }
    }
    Ok(changed)
}

// ---- Overlay (local Browser Source page; shows only what the seller pushes here) ----

#[derive(Default)]
pub struct OverlayState {
    pub shared: crate::overlay::SharedOverlay,
    pub port: Mutex<Option<u16>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayInfo {
    pub url: Option<String>,
}

#[tauri::command]
pub fn overlay_set(
    state: State<'_, OverlayState>,
    overlay: crate::overlay::OverlayState,
) -> Result<(), String> {
    let clean = crate::overlay::sanitize(&overlay);
    *state
        .shared
        .lock()
        .map_err(|_| "overlay lock poisoned".to_string())? = clean;
    Ok(())
}

#[tauri::command]
pub fn overlay_info(state: State<'_, OverlayState>) -> OverlayInfo {
    let port = state.port.lock().ok().and_then(|p| *p);
    OverlayInfo {
        url: port.map(|p| format!("http://127.0.0.1:{p}/overlay/live-product")),
    }
}

// ---- Hardening: report, export, retention, backup, wipe ----

use crate::data::{self, AuditDto, SessionSummary};
use crate::ship;
use tauri::Manager;

#[tauri::command]
pub fn report_sessions(state: State<'_, DbState>) -> Result<Vec<SessionSummary>, String> {
    data::session_summaries(&*db(&state)?).map_err(err)
}

#[tauri::command]
pub fn audit_list(state: State<'_, DbState>, limit: usize) -> Result<Vec<AuditDto>, String> {
    data::audit_list(&*db(&state)?, limit).map_err(err)
}

/// Where exports and backups go: the user's Downloads folder, else the app data folder.
fn out_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(err)?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

fn stamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Safe short piece of a session id for a file name.
fn short_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect()
}

/// Write a session export (`json` = everything, `orders_csv` = orders only). Returns the path.
#[tauri::command]
pub fn data_export(
    app: AppHandle,
    state: State<'_, DbState>,
    session_id: String,
    format: String,
) -> Result<String, String> {
    let (body, ext, tag) = {
        let conn = db(&state)?;
        match format.as_str() {
            "json" => (
                data::export_json(&conn, &session_id).map_err(err)?,
                "json",
                "session",
            ),
            "orders_csv" => (
                data::export_orders_csv(&conn, &session_id).map_err(err)?,
                "csv",
                "orders",
            ),
            _ => return Err("BAD_FORMAT".into()),
        }
    };
    let path = out_dir(&app)?.join(format!(
        "live-studio-{tag}-{}-{}.{ext}",
        short_id(&session_id),
        stamp()
    ));
    std::fs::write(&path, body).map_err(err)?;
    log(&state, "EXPORT", &format!("format={format}"));
    Ok(path.display().to_string())
}

/// Copy the whole database to a new file in Downloads. The copy holds comments and usernames.
#[tauri::command]
pub fn data_backup(app: AppHandle, state: State<'_, DbState>) -> Result<String, String> {
    let path = out_dir(&app)?.join(format!("live-studio-backup-{}.db", stamp()));
    data::backup_to(&*db(&state)?, &path).map_err(err)?;
    log(&state, "BACKUP", "");
    Ok(path.display().to_string())
}

/// Delete sessions older than `days` (0 = keep forever). Returns how many were removed.
#[tauri::command]
pub fn data_purge_older(state: State<'_, DbState>, days: u32) -> Result<usize, String> {
    let n = data::purge_older_than(&*db(&state)?, days).map_err(err)?;
    if n > 0 {
        log(
            &state,
            "RETENTION_PURGE",
            &format!("days={days} sessions={n}"),
        );
    }
    Ok(n)
}

#[tauri::command]
pub fn data_delete_all(state: State<'_, DbState>, include_catalog: bool) -> Result<usize, String> {
    let n = data::delete_all(&*db(&state)?, include_catalog).map_err(err)?;
    log(
        &state,
        "DELETE_ALL",
        &format!("sessions={n} catalog={include_catalog}"),
    );
    Ok(n)
}

// ---- Network printer (raw TCP / ESC/POS raster; private addresses only) ----

use crate::printer;

/// Print a bitmap page. `bits` is `ceil(width/8)` bytes per row, 1 = black.
/// Returns Ok, or one of the short codes of `printer::PrintError`. Only the outcome is logged.
#[tauri::command]
pub async fn printer_print(
    dbs: State<'_, DbState>,
    host: String,
    port: u16,
    width: usize,
    height: usize,
    bits: Vec<u8>,
) -> Result<(), String> {
    let result = async {
        let addr = printer::parse_target(&host, port)?;
        let job = printer::build_job(width, height, &bits)?;
        printer::send(addr, &job).await
    }
    .await;
    match result {
        Ok(()) => {
            log(&dbs, "PRINT_OK", "");
            Ok(())
        }
        Err(e) => {
            log(&dbs, "PRINT_ERROR", &format!("code={}", e.code()));
            Err(e.code().to_string())
        }
    }
}

/// Check that the printer accepts a connection; prints nothing.
#[tauri::command]
pub async fn printer_probe(host: String, port: u16) -> Result<(), String> {
    let addr = printer::parse_target(&host, port).map_err(|e| e.code().to_string())?;
    printer::probe(addr).await.map_err(|e| e.code().to_string())
}

// ---- shipping orders (7-ELEVEN pickup) and saved customers ----

#[tauri::command]
pub fn ship_orders(state: State<'_, DbState>) -> Result<Vec<ship::ShipOrderDto>, String> {
    ship::order_list(&*db(&state)?).map_err(err)
}

#[tauri::command]
pub fn ship_order_save(
    state: State<'_, DbState>,
    order: ship::ShipOrderDto,
    remember: bool,
    now: String,
) -> Result<ship::ShipOrderDto, String> {
    let saved = ship::order_save(&*db(&state)?, &order, remember, &now).map_err(err)?;
    log(&state, "SHIP_SAVED", "");
    Ok(saved)
}

#[tauri::command]
pub fn ship_order_delete(
    state: State<'_, DbState>,
    id: String,
    now: String,
) -> Result<usize, String> {
    let n = ship::order_delete(&*db(&state)?, &id, &now).map_err(err)?;
    log(&state, "SHIP_DELETED", "");
    Ok(n)
}

#[tauri::command]
pub fn ship_order_exported(
    state: State<'_, DbState>,
    ids: Vec<String>,
    exported: bool,
) -> Result<usize, String> {
    let n = ship::order_set_exported(&*db(&state)?, &ids, exported).map_err(err)?;
    log(&state, "SHIP_EXPORTED", &format!("count={n}"));
    Ok(n)
}

#[tauri::command]
pub fn ship_customers(state: State<'_, DbState>) -> Result<Vec<ship::CustomerDto>, String> {
    ship::customer_list(&*db(&state)?).map_err(err)
}

#[tauri::command]
pub fn ship_customer_save(
    state: State<'_, DbState>,
    customer: ship::CustomerDto,
    now: String,
) -> Result<ship::CustomerDto, String> {
    ship::customer_save(&*db(&state)?, &customer, &now).map_err(err)
}

#[tauri::command]
pub fn ship_customer_delete(state: State<'_, DbState>, tiktok_id: String) -> Result<usize, String> {
    ship::customer_delete(&*db(&state)?, &tiktok_id).map_err(err)
}

/// Import 7-ELEVEN stores from text (`code,name,address` per line). Returns (imported, skipped).
#[tauri::command]
pub fn ship_stores_import(
    state: State<'_, DbState>,
    body: String,
) -> Result<(usize, usize), String> {
    let r = ship::stores_import(&mut *db(&state)?, &body).map_err(err)?;
    log(&state, "SHIP_STORES_IMPORT", &format!("count={}", r.0));
    Ok(r)
}

#[tauri::command]
pub fn ship_store_lookup(
    state: State<'_, DbState>,
    code: String,
) -> Result<Option<ship::StoreDto>, String> {
    ship::store_lookup(&*db(&state)?, &code).map_err(err)
}

#[tauri::command]
pub fn ship_stores_count(state: State<'_, DbState>) -> Result<i64, String> {
    ship::stores_count(&*db(&state)?).map_err(err)
}

/// Write the selected shipping orders (or every pending one when `ids` is empty) into the
/// 7-ELEVEN order-import workbook in Downloads. Optionally marks them as exported.
#[tauri::command]
pub fn ship_export_xlsx(
    app: AppHandle,
    state: State<'_, DbState>,
    ids: Vec<String>,
    mark: bool,
) -> Result<String, String> {
    let (bytes, used) = {
        let conn = db(&state)?;
        let all = ship::order_list(&conn).map_err(err)?;
        let mut chosen: Vec<_> = if ids.is_empty() {
            all.into_iter().filter(|o| !o.exported).collect()
        } else {
            all.into_iter().filter(|o| ids.contains(&o.id)).collect()
        };
        chosen.reverse(); // oldest first
        let bytes = ship::export_xlsx(&chosen)?;
        (bytes, chosen.into_iter().map(|o| o.id).collect::<Vec<_>>())
    };
    let path = out_dir(&app)?.join(format!("7-eleven-orders-{}.xlsx", stamp()));
    if path.exists() {
        return Err("EXISTS".into());
    }
    std::fs::write(&path, bytes).map_err(err)?;
    if mark {
        ship::order_set_exported(&*db(&state)?, &used, true).map_err(err)?;
    }
    log(
        &state,
        "SHIP_EXPORTED",
        &format!("xlsx rows={}", used.len()),
    );
    Ok(path.display().to_string())
}

/// Look a 7-ELEVEN store up by number, name or address, using the public map page of 7-ELEVEN
/// (the same request its own store picker makes). Called only when the seller types a search;
/// usable results are kept locally so the number works offline next time.
#[tauri::command]
pub async fn ship_store_search(
    state: State<'_, DbState>,
    query: String,
) -> Result<Vec<ship::StoreHit>, String> {
    let q = ship::clean_search(&query).ok_or("BAD_QUERY")?;
    let body = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("searchKey", &q)
        .append_pair("cate", "")
        .append_pair("eshopid", "")
        .append_pair("eshopparid", "")
        .append_pair("multiple_type", "")
        .finish();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|_| "NETWORK")?;
    let resp = client
        .post(ship::SEARCH_URL)
        .header("Content-Type", "application/x-www-form-urlencoded;")
        .body(body)
        .send()
        .await
        .map_err(|_| "NETWORK")?;
    if !resp.status().is_success() {
        return Err("NETWORK".into());
    }
    let text = resp.text().await.map_err(|_| "NETWORK")?;
    let mut hits = ship::parse_store_lines(&text);
    hits.truncate(ship::MAX_HITS);
    ship::stores_cache(&*db(&state)?, &hits).map_err(err)?;
    Ok(hits)
}

#[tauri::command]
pub fn flow_list(state: State<'_, DbState>) -> Result<Vec<ship::FlowDto>, String> {
    ship::flow_list(&*db(&state)?).map_err(err)
}

#[tauri::command]
pub fn flow_mark(
    state: State<'_, DbState>,
    tiktok_id: String,
    step: String,
    now: String,
) -> Result<(), String> {
    ship::flow_mark(&*db(&state)?, &tiktok_id, &step, &now).map_err(err)
}

// ---- phone sharing (only the desktop window can switch it on or off) ----

use crate::share::{self, PrinterCfg, ShareInfo, ShareState};

#[tauri::command]
pub fn share_start(app: AppHandle, state: State<'_, ShareState>) -> Result<ShareInfo, String> {
    let info = share::start(&app, &state)?;
    log(&app.state::<DbState>(), "SHARE_START", "");
    Ok(info)
}

#[tauri::command]
pub fn share_stop(app: AppHandle, state: State<'_, ShareState>) -> Result<ShareInfo, String> {
    let info = share::stop(&state)?;
    log(&app.state::<DbState>(), "SHARE_STOP", "");
    Ok(info)
}

#[tauri::command]
pub fn share_status(state: State<'_, ShareState>) -> Result<ShareInfo, String> {
    share::status(&state)
}

/// The printer chosen on this computer, so a phone can print to it without knowing its address.
#[tauri::command]
pub fn share_set_printer(
    state: State<'_, ShareState>,
    host: String,
    port: u16,
    width_dots: usize,
    kind: Option<String>,
) -> Result<(), String> {
    let cfg = if host.trim().is_empty() {
        None
    } else {
        // Same address rules as printing itself.
        crate::printer::parse_target(host.trim(), port).map_err(|e| e.code().to_string())?;
        Some(PrinterCfg {
            host: host.trim().to_string(),
            port,
            width_dots,
        })
    };
    share::set_printer(&state, kind.as_deref() == Some("label"), cfg)
}

// ---- shop books (stock, purchases, expenses) ----

#[tauri::command]
pub fn biz_stock_list(state: State<'_, DbState>) -> Result<Vec<crate::biz::StockDto>, String> {
    crate::biz::stock_list(&*db(&state)?).map_err(err)
}

#[tauri::command]
pub fn biz_stock_save(
    state: State<'_, DbState>,
    item: crate::biz::StockDto,
    now: String,
) -> Result<(), String> {
    crate::biz::stock_save(&*db(&state)?, &item, &now).map_err(err)?;
    log(&state, "BIZ_SAVED", "stock");
    Ok(())
}

#[tauri::command]
pub fn biz_stock_delete(state: State<'_, DbState>, sku: String) -> Result<usize, String> {
    let n = crate::biz::stock_delete(&*db(&state)?, &sku).map_err(err)?;
    log(&state, "BIZ_DELETED", "stock");
    Ok(n)
}

#[tauri::command]
pub fn biz_purchase_list(
    state: State<'_, DbState>,
) -> Result<Vec<crate::biz::PurchaseDto>, String> {
    crate::biz::purchase_list(&*db(&state)?).map_err(err)
}

#[tauri::command]
pub fn biz_purchase_add(
    state: State<'_, DbState>,
    purchase: crate::biz::PurchaseDto,
    now: String,
) -> Result<(), String> {
    crate::biz::purchase_add(&*db(&state)?, &purchase, &now).map_err(err)?;
    log(&state, "BIZ_SAVED", "purchase");
    Ok(())
}

#[tauri::command]
pub fn biz_purchase_delete(
    state: State<'_, DbState>,
    id: String,
    now: String,
) -> Result<usize, String> {
    let n = crate::biz::purchase_delete(&*db(&state)?, &id, &now).map_err(err)?;
    log(&state, "BIZ_DELETED", "purchase");
    Ok(n)
}

#[tauri::command]
pub fn biz_expense_list(state: State<'_, DbState>) -> Result<Vec<crate::biz::ExpenseDto>, String> {
    crate::biz::expense_list(&*db(&state)?).map_err(err)
}

#[tauri::command]
pub fn biz_expense_save(
    state: State<'_, DbState>,
    expense: crate::biz::ExpenseDto,
    now: String,
) -> Result<(), String> {
    crate::biz::expense_save(&*db(&state)?, &expense, &now).map_err(err)?;
    log(&state, "BIZ_SAVED", "expense");
    Ok(())
}

#[tauri::command]
pub fn biz_expense_delete(state: State<'_, DbState>, id: String) -> Result<usize, String> {
    let n = crate::biz::expense_delete(&*db(&state)?, &id).map_err(err)?;
    log(&state, "BIZ_DELETED", "expense");
    Ok(n)
}

// ---------- shipping carriers ----------

/// Result of asking ECPay about the saved keys. `accepted` is true only on a real answer from ECPay.
#[tauri::command]
pub async fn ecpay_check(
    secrets: State<'_, SecretState>,
    stage: bool,
) -> Result<crate::ecpay::CheckResult, String> {
    crate::ecpay::check(&*secrets.0, stage).await
}

/// Make a convenience-store waybill at ECPay and keep its numbers on the order.
#[tauri::command]
pub async fn ecpay_create(
    secrets: State<'_, SecretState>,
    state: State<'_, DbState>,
    stage: bool,
    order_id: String,
    waybill: crate::ecpay::NewWaybill,
) -> Result<crate::ecpay::Waybill, String> {
    let trade_no = waybill.trade_no.clone();
    let result = crate::ecpay::create(&*secrets.0, stage, &waybill).await?;
    if result.ok {
        let tracking = if result.payment_no.is_empty() {
            result.logistics_id.clone()
        } else {
            format!("{}{}", result.payment_no, result.validation_no)
        };
        crate::ship::order_waybill(&*db(&state)?, &order_id, "ecpay", &trade_no, &tracking)
            .map_err(err)?;
        log(&state, "WAYBILL_CREATED", "carrier=ecpay");
    } else {
        log(&state, "WAYBILL_FAILED", "carrier=ecpay");
    }
    Ok(result)
}

#[tauri::command]
pub async fn ecpay_query(
    secrets: State<'_, SecretState>,
    stage: bool,
    trade_no: String,
) -> Result<crate::ecpay::TradeStatus, String> {
    crate::ecpay::query(&*secrets.0, stage, &trade_no).await
}

/// Open a carrier's own page in the system browser. Only https pages of the known carriers.
#[tauri::command]
pub fn open_carrier_page(url: String) -> Result<(), String> {
    crate::browser::open_carrier(&url)
}

// ---------- ad platforms (TikTok / Meta / Google — the seller's own ad accounts, BYOK) ----------

#[tauri::command]
pub async fn ads_stats(
    secrets: State<'_, SecretState>,
    platform: String,
) -> Result<crate::ads::AdStats, String> {
    let p = crate::ads::Platform::parse(&platform)?;
    crate::ads::fetch_stats(&*secrets.0, p).await
}

#[tauri::command]
pub async fn ads_campaigns(
    secrets: State<'_, SecretState>,
    platform: String,
) -> Result<Vec<crate::ads::AdCampaign>, String> {
    let p = crate::ads::Platform::parse(&platform)?;
    crate::ads::fetch_campaigns(&*secrets.0, p).await
}

#[tauri::command]
pub async fn ads_set_campaign_status(
    state: State<'_, DbState>,
    secrets: State<'_, SecretState>,
    platform: String,
    campaign_id: String,
    enabled: bool,
) -> Result<(), String> {
    let p = crate::ads::Platform::parse(&platform)?;
    crate::ads::set_campaign_status(&*secrets.0, p, &campaign_id, enabled).await?;
    log(
        &state,
        if enabled {
            "AD_CAMPAIGN_ENABLED"
        } else {
            "AD_CAMPAIGN_PAUSED"
        },
        &format!("platform={platform}"),
    );
    Ok(())
}

// ---------- warehouse (barcode per unit) ----------

#[tauri::command]
pub fn wh_receive(
    state: State<'_, DbState>,
    req: crate::wh::ReceiveReq,
    now: String,
) -> Result<Vec<crate::wh::UnitDto>, String> {
    let units = crate::wh::receive(&*db(&state)?, &req, &now)?;
    log(&state, "WH_RECEIVED", &format!("units={}", units.len()));
    Ok(units)
}

#[tauri::command]
pub fn wh_ship(
    state: State<'_, DbState>,
    codes: Vec<String>,
    order_id: String,
    stock_handled: bool,
    now: String,
) -> Result<crate::wh::ShipResult, String> {
    let r = crate::wh::ship(&*db(&state)?, &codes, &order_id, stock_handled, &now)?;
    log(&state, "WH_SHIPPED", &format!("units={}", r.units.len()));
    Ok(r)
}

#[tauri::command]
pub fn wh_unit_get(
    state: State<'_, DbState>,
    code: String,
) -> Result<Option<crate::wh::UnitDto>, String> {
    crate::wh::unit_get(&*db(&state)?, &code)
}

#[tauri::command]
pub fn wh_units_list(
    state: State<'_, DbState>,
    status: String,
    limit: i64,
) -> Result<Vec<crate::wh::UnitDto>, String> {
    crate::wh::units_list(&*db(&state)?, &status, limit)
}

#[tauri::command]
pub fn wh_move(
    state: State<'_, DbState>,
    code: String,
    location: String,
    now: String,
) -> Result<crate::wh::UnitDto, String> {
    crate::wh::move_to(&*db(&state)?, &code, &location, &now)
}

#[tauri::command]
pub fn wh_void(
    state: State<'_, DbState>,
    code: String,
    reason: String,
    now: String,
) -> Result<crate::wh::UnitDto, String> {
    let u = crate::wh::void(&*db(&state)?, &code, &reason, &now)?;
    log(&state, "WH_ADJUSTED", "void");
    Ok(u)
}

#[tauri::command]
pub fn wh_restock(
    state: State<'_, DbState>,
    code: String,
    location: String,
    now: String,
) -> Result<crate::wh::UnitDto, String> {
    let u = crate::wh::restock(&*db(&state)?, &code, &location, &now)?;
    log(&state, "WH_ADJUSTED", "restock");
    Ok(u)
}

#[tauri::command]
pub fn wh_count_apply(
    state: State<'_, DbState>,
    location: String,
    scanned: Vec<String>,
    now: String,
) -> Result<crate::wh::CountResult, String> {
    let r = crate::wh::count_apply(&*db(&state)?, &location, &scanned, &now)?;
    log(
        &state,
        "WH_ADJUSTED",
        &format!("count missing={}", r.missing.len()),
    );
    Ok(r)
}

#[tauri::command]
pub fn wh_moves_list(
    state: State<'_, DbState>,
    limit: i64,
) -> Result<Vec<crate::wh::MoveDto>, String> {
    crate::wh::moves_list(&*db(&state)?, limit)
}

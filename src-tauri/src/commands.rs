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

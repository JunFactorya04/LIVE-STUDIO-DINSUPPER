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

#[tauri::command]
pub fn live_create_session(state: State<'_, DbState>, session: NewSession) -> Result<(), String> {
    live::create_session(&*db(&state)?, &session).map_err(err)
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
    live::delete_session(&*db(&state)?, &session_id).map_err(err)
}

// Secrets: write, check, remove. There is intentionally no command that returns a key.

#[tauri::command]
pub fn secret_set(
    state: State<'_, SecretState>,
    slot: String,
    value: String,
) -> Result<(), String> {
    secrets::set_secret(state.0.as_ref(), &slot, &value)
}

#[tauri::command]
pub fn secret_exists(state: State<'_, SecretState>, slot: String) -> Result<bool, String> {
    secrets::secret_exists(state.0.as_ref(), &slot)
}

#[tauri::command]
pub fn secret_remove(state: State<'_, SecretState>, slot: String) -> Result<(), String> {
    secrets::remove_secret(state.0.as_ref(), &slot)
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
    session_id: String,
    unique_id: String,
) -> Result<(), String> {
    stop_euler(&euler);

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
pub fn euler_disconnect(euler: State<'_, EulerState>) {
    stop_euler(&euler);
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
    orders::order_set_status(&*db(&state)?, &id, &status, &now).map_err(err)
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
    provider: String,
    model: Option<String>,
    system: String,
    prompt: String,
    max_tokens: Option<u32>,
) -> Result<String, String> {
    crate::ai::complete(
        &*state.0,
        &provider,
        model.as_deref(),
        &system,
        &prompt,
        max_tokens.unwrap_or(256),
        None,
    )
    .await
    .map_err(|e| e.code().to_string())
}

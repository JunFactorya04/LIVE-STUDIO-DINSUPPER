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

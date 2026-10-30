// Backend entry. Keep platform-specific code behind #[cfg(target_os = "...")]
// so the same source builds on macOS and Windows.

mod commands;
mod db;
mod live;
mod secrets;

use std::sync::Mutex;
use tauri::Manager;

#[tauri::command]
fn app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "LIVE STUDIO",
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
    })
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("live-studio.db"))?;
            app.manage(commands::DbState(Mutex::new(conn)));
            app.manage(commands::SecretState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            commands::live_create_session,
            commands::live_update_session,
            commands::live_latest_session,
            commands::live_ingest_comments,
            commands::live_list_comments,
            commands::live_delete_comments,
            commands::live_delete_session,
            commands::secret_set,
            commands::secret_exists,
            commands::secret_remove,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LIVE STUDIO");
}

// Backend entry. Commands for storage, platform APIs and live streaming are added here.
// Keep platform-specific code behind #[cfg(target_os = "...")] so the same source builds on macOS and Windows.

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
        .invoke_handler(tauri::generate_handler![app_info])
        .run(tauri::generate_context!())
        .expect("error while running LIVE STUDIO");
}

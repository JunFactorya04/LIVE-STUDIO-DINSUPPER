// Backend entry. Keep platform-specific code behind #[cfg(target_os = "...")]
// so the same source builds on macOS and Windows.

mod ai;
mod biz;
mod browser;
mod commands;
mod data;
mod db;
mod ecpay;
mod euler;
mod live;
mod orders;
mod overlay;
mod printer;
mod replies;
mod secrets;
mod share;
mod ship;

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
            app.manage(commands::EulerState::default());
            // Local overlay server (127.0.0.1 only). If no port is free the overlay is simply off.
            let overlay = commands::OverlayState::default();
            if let Ok(listener) = overlay::bind(overlay::FIRST_PORT) {
                if let Ok(addr) = listener.local_addr() {
                    *overlay.port.lock().unwrap() = Some(addr.port());
                }
                tauri::async_runtime::spawn(overlay::serve(listener, overlay.shared.clone()));
            }
            app.manage(overlay);
            app.manage(share::ShareState::default());
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
            commands::live_set_intents,
            commands::live_delete_session,
            commands::secret_set,
            commands::secret_exists,
            commands::secret_remove,
            commands::catalog_list,
            commands::catalog_upsert,
            commands::catalog_delete,
            commands::order_save,
            commands::order_list,
            commands::order_set_status,
            commands::ai_complete,
            commands::ai_providers,
            commands::reply_create,
            commands::reply_list,
            commands::reply_update,
            commands::overlay_set,
            commands::overlay_info,
            commands::printer_print,
            commands::printer_probe,
            commands::euler_connect,
            commands::euler_disconnect,
            commands::report_sessions,
            commands::audit_list,
            commands::data_export,
            commands::data_backup,
            commands::data_purge_older,
            commands::data_delete_all,
            commands::share_start,
            commands::share_stop,
            commands::share_status,
            commands::share_set_printer,
            commands::ship_orders,
            commands::flow_list,
            commands::flow_mark,
            commands::ship_export_xlsx,
            commands::ship_order_save,
            commands::ship_order_delete,
            commands::ecpay_check,
            commands::ecpay_create,
            commands::ecpay_query,
            commands::open_carrier_page,
            commands::biz_stock_list,
            commands::biz_stock_save,
            commands::biz_stock_delete,
            commands::biz_purchase_list,
            commands::biz_purchase_add,
            commands::biz_purchase_delete,
            commands::biz_expense_list,
            commands::biz_expense_save,
            commands::biz_expense_delete,
            commands::ship_order_exported,
            commands::ship_customers,
            commands::ship_customer_save,
            commands::ship_customer_delete,
            commands::ship_stores_import,
            commands::ship_store_lookup,
            commands::ship_store_search,
            commands::ship_stores_count,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LIVE STUDIO");
}

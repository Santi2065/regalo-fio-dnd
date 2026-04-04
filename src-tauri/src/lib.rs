mod assets;
mod db;
mod notes;
mod session;

use std::sync::Mutex;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = db::open().expect("Failed to open database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            db: Mutex::new(conn),
        })
        .invoke_handler(tauri::generate_handler![
            session::get_sessions,
            session::create_session,
            session::update_session,
            session::delete_session,
            assets::get_assets,
            assets::import_assets,
            assets::update_asset,
            assets::delete_asset,
            notes::get_notes,
            notes::create_note,
            notes::update_note,
            notes::delete_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

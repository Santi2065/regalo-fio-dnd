mod assets;
mod audio;
mod db;
mod display;
mod notes;
mod session;

use std::sync::Mutex;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = db::open().expect("Failed to open database");

    // Initialize audio engine eagerly so the first sound plays without delay
    audio::init_audio();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            db: Mutex::new(conn),
        })
        .invoke_handler(tauri::generate_handler![
            // Sessions
            session::get_sessions,
            session::create_session,
            session::update_session,
            session::delete_session,
            // Assets
            assets::get_assets,
            assets::import_assets,
            assets::update_asset,
            assets::delete_asset,
            // Notes
            notes::get_notes,
            notes::create_note,
            notes::update_note,
            notes::delete_note,
            // Audio
            audio::play_sfx,
            audio::play_ambient,
            audio::stop_ambient,
            audio::stop_all_audio,
            audio::set_ambient_volume,
            audio::get_soundboard,
            audio::add_soundboard_slot,
            audio::update_soundboard_slot,
            audio::remove_soundboard_slot,
            // Display
            display::get_monitors,
            display::open_player_display,
            display::close_player_display,
            display::project_scene,
            display::clear_player_display,
            display::player_display_open,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

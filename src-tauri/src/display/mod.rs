use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MonitorInfo {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub is_primary: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DisplayScene {
    pub file_path: String,
    pub asset_type: String,
    pub title: Option<String>,
}

const PLAYER_WINDOW_LABEL: &str = "player-display";

#[tauri::command]
pub fn get_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let primary = app.primary_monitor().ok().flatten();

    let result = monitors
        .into_iter()
        .map(|m| {
            let pos = m.position();
            let size = m.size();
            let m_pos = m.position();
            let is_primary = primary.as_ref().map_or(false, |p| {
                let p_pos = p.position();
                p_pos.x == m_pos.x && p_pos.y == m_pos.y
            });
            MonitorInfo {
                name: m.name().map(|s| s.as_str()).unwrap_or("Unknown").to_string(),
                width: size.width,
                height: size.height,
                x: pos.x,
                y: pos.y,
                is_primary,
            }
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub fn open_player_display(
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: u32,
    monitor_height: u32,
    app: AppHandle,
) -> Result<(), String> {
    // Close existing player window if any
    if let Some(existing) = app.get_webview_window(PLAYER_WINDOW_LABEL) {
        existing.close().ok();
    }

    WebviewWindowBuilder::new(
        &app,
        PLAYER_WINDOW_LABEL,
        WebviewUrl::App("player.html".into()),
    )
    .title("DnD Orchestrator — Player Display")
    .inner_size(monitor_width as f64, monitor_height as f64)
    .position(monitor_x as f64, monitor_y as f64)
    .fullscreen(true)
    .decorations(false)
    .always_on_top(true)
    .resizable(false)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn close_player_display(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PLAYER_WINDOW_LABEL) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn project_scene(scene: DisplayScene, app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PLAYER_WINDOW_LABEL) {
        window
            .emit("scene-change", &scene)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_player_display(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PLAYER_WINDOW_LABEL) {
        window
            .emit("scene-clear", ())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn player_display_open(app: AppHandle) -> bool {
    app.get_webview_window(PLAYER_WINDOW_LABEL).is_some()
}

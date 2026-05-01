use once_cell::sync::OnceCell;
use rodio::{Decoder, OutputStreamHandle, Sink, Source};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::sync::Mutex;
use tauri::State;

use crate::AppState;

struct AudioState {
    handle: OutputStreamHandle,
    /// Named ambient sinks (looping background tracks)
    ambient: HashMap<String, Sink>,
    /// SFX sinks — retained until they finish playing
    sfx: Vec<Sink>,
}

// OutputStreamHandle is Send+Sync; we leak the OutputStream to keep it alive.
static AUDIO: OnceCell<Mutex<AudioState>> = OnceCell::new();

pub fn init_audio() {
    match rodio::OutputStream::try_default() {
        Ok((stream, handle)) => {
            // Leak the stream so it lives for the entire process lifetime.
            Box::leak(Box::new(stream));
            let state = AudioState {
                handle,
                ambient: HashMap::new(),
                sfx: Vec::new(),
            };
            let _ = AUDIO.set(Mutex::new(state));
        }
        Err(e) => {
            eprintln!("Audio init failed: {e}");
        }
    }
}

fn with_audio<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce(&mut AudioState) -> Result<T, String>,
{
    let cell = AUDIO.get().ok_or("Audio not initialized")?;
    let mut guard = cell.lock().map_err(|e| e.to_string())?;
    f(&mut guard)
}

// ── Playback commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn play_sfx(file_path: String, volume: f32) -> Result<(), String> {
    with_audio(|audio| {
        // Limpieza: descartamos sinks que ya terminaron de sonar.
        audio.sfx.retain(|s| !s.empty());

        let file = File::open(&file_path).map_err(|e| format!("File error: {e}"))?;
        let source = Decoder::new(BufReader::new(file))
            .map_err(|e| format!("Decode error: {e}"))?;

        let sink =
            Sink::try_new(&audio.handle).map_err(|e| format!("Sink error: {e}"))?;
        sink.set_volume(volume.clamp(0.0, 2.0));
        sink.append(source);
        // ANTES: sink.detach() — el sink se desvinculaba del control y `stop_all_audio`
        // no lo podía parar. Ahora lo guardamos en `audio.sfx` para que el "Stop todo"
        // pueda apagarlo. La línea `retain(...)` de arriba purga los terminados así
        // el Vec no crece sin límite.
        audio.sfx.push(sink);
        Ok(())
    })
}

#[tauri::command]
pub fn play_ambient(channel: String, file_path: String, volume: f32) -> Result<(), String> {
    with_audio(|audio| {
        if let Some(old) = audio.ambient.remove(&channel) {
            old.stop();
        }

        let file = File::open(&file_path).map_err(|e| format!("File error: {e}"))?;
        let source = Decoder::new(BufReader::new(file))
            .map_err(|e| format!("Decode error: {e}"))?
            .repeat_infinite();

        let sink =
            Sink::try_new(&audio.handle).map_err(|e| format!("Sink error: {e}"))?;
        sink.set_volume(volume.clamp(0.0, 2.0));
        sink.append(source);
        audio.ambient.insert(channel, sink);
        Ok(())
    })
}

#[tauri::command]
pub fn stop_ambient(channel: String) -> Result<(), String> {
    with_audio(|audio| {
        if let Some(sink) = audio.ambient.remove(&channel) {
            sink.stop();
        }
        Ok(())
    })
}

#[tauri::command]
pub fn stop_all_audio() -> Result<(), String> {
    with_audio(|audio| {
        for (_, sink) in audio.ambient.drain() {
            sink.stop();
        }
        audio.sfx.drain(..).for_each(|s| s.stop());
        Ok(())
    })
}

#[tauri::command]
pub fn set_ambient_volume(channel: String, volume: f32) -> Result<(), String> {
    with_audio(|audio| {
        if let Some(sink) = audio.ambient.get(&channel) {
            sink.set_volume(volume.clamp(0.0, 2.0));
        }
        Ok(())
    })
}

// ── Soundboard DB commands ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct SoundboardSlot {
    pub id: String,
    pub session_id: String,
    pub slot_position: i64,
    pub asset_id: String,
    pub label: Option<String>,
    pub volume: f32,
    pub loop_enabled: bool,
    pub hotkey: Option<String>,
    pub color: Option<String>,
    pub file_path: Option<String>,
    pub asset_name: Option<String>,
}

#[tauri::command]
pub fn get_soundboard(
    session_id: String,
    state: State<AppState>,
) -> Result<Vec<SoundboardSlot>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.session_id, s.slot_position, s.asset_id, s.label,
                    s.volume, s.loop_enabled, s.hotkey, s.color,
                    a.file_path, a.name
             FROM soundboard_slots s
             LEFT JOIN assets a ON a.id = s.asset_id
             WHERE s.session_id = ?1
             ORDER BY s.slot_position ASC",
        )
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    let mapped = stmt
        .query_map(rusqlite::params![session_id], |row| {
            Ok(SoundboardSlot {
                id: row.get(0)?,
                session_id: row.get(1)?,
                slot_position: row.get(2)?,
                asset_id: row.get(3)?,
                label: row.get(4)?,
                volume: row.get(5)?,
                loop_enabled: row.get::<_, i64>(6)? != 0,
                hotkey: row.get(7)?,
                color: row.get(8)?,
                file_path: row.get(9)?,
                asset_name: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;

    for row in mapped {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
pub fn add_soundboard_slot(
    session_id: String,
    slot_position: i64,
    asset_id: String,
    label: Option<String>,
    volume: f32,
    loop_enabled: bool,
    color: Option<String>,
    state: State<AppState>,
) -> Result<SoundboardSlot, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();

    let (file_path, asset_name): (String, String) = conn
        .query_row(
            "SELECT file_path, name FROM assets WHERE id = ?1",
            rusqlite::params![asset_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("Asset not found: {e}"))?;

    conn.execute(
        "INSERT INTO soundboard_slots (id, session_id, slot_position, asset_id, label, volume, loop_enabled, color)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![id, session_id, slot_position, asset_id, label, volume, loop_enabled as i64, color],
    )
    .map_err(|e| e.to_string())?;

    Ok(SoundboardSlot {
        id,
        session_id,
        slot_position,
        asset_id,
        label,
        volume,
        loop_enabled,
        hotkey: None,
        color,
        file_path: Some(file_path),
        asset_name: Some(asset_name),
    })
}

#[tauri::command]
pub fn update_soundboard_slot(
    id: String,
    label: Option<String>,
    volume: f32,
    loop_enabled: bool,
    hotkey: Option<String>,
    color: Option<String>,
    state: State<AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE soundboard_slots SET label=?1, volume=?2, loop_enabled=?3, hotkey=?4, color=?5 WHERE id=?6",
        rusqlite::params![label, volume, loop_enabled as i64, hotkey, color, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn remove_soundboard_slot(id: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM soundboard_slots WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

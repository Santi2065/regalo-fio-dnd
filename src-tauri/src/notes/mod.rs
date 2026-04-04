use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[tauri::command]
pub fn get_notes(session_id: String, state: State<AppState>) -> Result<Vec<Note>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, title, content, created_at, updated_at
             FROM notes WHERE session_id = ?1 ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let notes = stmt
        .query_map(rusqlite::params![session_id], |row| {
            Ok(Note {
                id: row.get(0)?,
                session_id: row.get(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(notes)
}

#[tauri::command]
pub fn create_note(
    session_id: String,
    title: String,
    content: Option<String>,
    state: State<AppState>,
) -> Result<Note, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now();
    let content = content.unwrap_or_default();

    conn.execute(
        "INSERT INTO notes (id, session_id, title, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, session_id, title, content, now, now],
    ).map_err(|e| e.to_string())?;

    Ok(Note {
        id,
        session_id,
        title,
        content,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_note(
    id: String,
    title: String,
    content: String,
    state: State<AppState>,
) -> Result<Note, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = now();

    conn.execute(
        "UPDATE notes SET title = ?1, content = ?2, updated_at = ?3 WHERE id = ?4",
        rusqlite::params![title, content, now, id],
    )
    .map_err(|e| e.to_string())?;

    let note = conn
        .query_row(
            "SELECT id, session_id, title, content, created_at, updated_at FROM notes WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(Note {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    title: row.get(2)?,
                    content: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(note)
}

#[tauri::command]
pub fn delete_note(id: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM notes WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

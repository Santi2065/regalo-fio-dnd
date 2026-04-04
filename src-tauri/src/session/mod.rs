use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn query_sessions(conn: &Connection) -> rusqlite::Result<Vec<Session>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, created_at, updated_at FROM sessions ORDER BY updated_at DESC",
    )?;
    let mut result = Vec::new();
    let mapped = stmt.query_map([], |row| {
        Ok(Session {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    for row in mapped {
        result.push(row?);
    }
    Ok(result)
}

#[tauri::command]
pub fn get_sessions(state: State<AppState>) -> Result<Vec<Session>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    query_sessions(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_session(
    name: String,
    description: Option<String>,
    state: State<AppState>,
) -> Result<Session, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now();

    // Create the session assets directory
    let assets_dir = crate::db::get_app_data_dir()
        .join("sessions")
        .join(&id)
        .join("assets");
    std::fs::create_dir_all(&assets_dir).ok();

    conn.execute(
        "INSERT INTO sessions (id, name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, name, description, now, now],
    ).map_err(|e| e.to_string())?;

    Ok(Session {
        id,
        name,
        description,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub fn update_session(
    id: String,
    name: String,
    description: Option<String>,
    state: State<AppState>,
) -> Result<Session, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = now();

    conn.execute(
        "UPDATE sessions SET name = ?1, description = ?2, updated_at = ?3 WHERE id = ?4",
        rusqlite::params![name, description, now, id],
    ).map_err(|e| e.to_string())?;

    let session: Session = conn
        .query_row(
            "SELECT id, name, description, created_at, updated_at FROM sessions WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok(Session {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            }),
        )
        .map_err(|e| e.to_string())?;

    Ok(session)
}

#[tauri::command]
pub fn delete_session(id: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sessions WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;

    // Clean up the session directory
    let session_dir = crate::db::get_app_data_dir().join("sessions").join(&id);
    std::fs::remove_dir_all(session_dir).ok();

    Ok(())
}

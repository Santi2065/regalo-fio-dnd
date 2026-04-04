use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct Guion {
    pub session_id: String,
    pub content: String,
    pub updated_at: String,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[tauri::command]
pub fn get_guion(session_id: String, state: State<AppState>) -> Result<Guion, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let result = conn.query_row(
        "SELECT session_id, content, updated_at FROM guion WHERE session_id = ?1",
        rusqlite::params![session_id],
        |row| {
            Ok(Guion {
                session_id: row.get(0)?,
                content: row.get(1)?,
                updated_at: row.get(2)?,
            })
        },
    );

    match result {
        Ok(g) => Ok(g),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            // Create empty guion for this session
            let now = now();
            conn.execute(
                "INSERT INTO guion (session_id, content, updated_at) VALUES (?1, '', ?2)",
                rusqlite::params![session_id, now],
            )
            .map_err(|e| e.to_string())?;
            Ok(Guion {
                session_id,
                content: String::new(),
                updated_at: now,
            })
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn save_guion(
    session_id: String,
    content: String,
    state: State<AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = now();

    conn.execute(
        "INSERT INTO guion (session_id, content, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at",
        rusqlite::params![session_id, content, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

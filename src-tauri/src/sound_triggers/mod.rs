//! Sound triggers — reglas if-then de audio automático (v1.4 / sub-proyecto C).
//!
//! El engine de evaluación corre 100% en el frontend (donde viven el state de
//! initiative, scene activa y el player de audio). Acá solo persistimos las
//! reglas como JSON opaco — el shape se valida y maneja en TypeScript. Esto
//! da más flexibilidad para que las reglas evolucionen sin migración de
//! schema.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SoundTrigger {
    pub id: String,
    pub session_id: String,
    /// JSON serializado con la forma `{ when, action, label, enabled }`.
    /// Lo deja como string para que el frontend valide el shape.
    pub config: String,
    pub sort_order: i64,
}

#[tauri::command]
pub fn get_sound_triggers(
    session_id: String,
    state: State<AppState>,
) -> Result<Vec<SoundTrigger>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, config, sort_order
             FROM sound_triggers
             WHERE session_id = ?1
             ORDER BY sort_order ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![session_id], |row| {
            Ok(SoundTrigger {
                id: row.get(0)?,
                session_id: row.get(1)?,
                config: row.get(2)?,
                sort_order: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

/// Reemplaza por completo las reglas de la sesión. Más simple que CRUD
/// individual — el frontend manda el set entero cada vez que cambia algo.
/// Cantidad esperada: <10 reglas por sesión.
#[tauri::command]
pub fn set_sound_triggers(
    session_id: String,
    triggers: Vec<SoundTriggerInput>,
    state: State<AppState>,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "DELETE FROM sound_triggers WHERE session_id = ?1",
        rusqlite::params![session_id],
    )
    .map_err(|e| e.to_string())?;

    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO sound_triggers (id, session_id, config, sort_order)
                 VALUES (?1, ?2, ?3, ?4)",
            )
            .map_err(|e| e.to_string())?;
        for (idx, t) in triggers.iter().enumerate() {
            stmt.execute(rusqlite::params![
                t.id,
                session_id,
                t.config,
                idx as i64,
            ])
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct SoundTriggerInput {
    pub id: String,
    pub config: String,
}

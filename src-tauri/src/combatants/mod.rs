use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Combatant {
    pub id: String,
    pub session_id: String,
    pub name: String,
    pub initiative: i32,
    pub hp: i32,
    pub max_hp: i32,
    #[serde(rename = "type")]
    pub kind: String,
    pub conditions: Vec<String>,
    pub notes: String,
    pub sort_order: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CombatantInput {
    pub id: String,
    pub name: String,
    pub initiative: i32,
    pub hp: i32,
    pub max_hp: i32,
    #[serde(rename = "type")]
    pub kind: String,
    pub conditions: Vec<String>,
    pub notes: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionCombatState {
    pub session_id: String,
    pub current_turn: i32,
    pub round: i32,
    pub custom_conditions: Vec<String>,
}

#[tauri::command]
pub fn get_combatants(session_id: String, state: State<AppState>) -> Result<Vec<Combatant>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, name, initiative, hp, max_hp, type, conditions, notes, sort_order
             FROM combatants WHERE session_id = ?1 ORDER BY sort_order ASC, initiative DESC",
        )
        .map_err(|e| e.to_string())?;

    let combatants = stmt
        .query_map(rusqlite::params![session_id], |row| {
            let conditions_json: String = row.get(7)?;
            let conditions: Vec<String> =
                serde_json::from_str(&conditions_json).unwrap_or_default();
            Ok(Combatant {
                id: row.get(0)?,
                session_id: row.get(1)?,
                name: row.get(2)?,
                initiative: row.get(3)?,
                hp: row.get(4)?,
                max_hp: row.get(5)?,
                kind: row.get(6)?,
                conditions,
                notes: row.get(8)?,
                sort_order: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(combatants)
}

#[tauri::command]
pub fn set_combatants(
    session_id: String,
    combatants: Vec<CombatantInput>,
    state: State<AppState>,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "DELETE FROM combatants WHERE session_id = ?1",
        rusqlite::params![session_id],
    )
    .map_err(|e| e.to_string())?;

    for (idx, c) in combatants.iter().enumerate() {
        let conditions_json = serde_json::to_string(&c.conditions).unwrap_or_else(|_| "[]".into());
        tx.execute(
            "INSERT INTO combatants
             (id, session_id, name, initiative, hp, max_hp, type, conditions, notes, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                c.id,
                session_id,
                c.name,
                c.initiative,
                c.hp,
                c.max_hp,
                c.kind,
                conditions_json,
                c.notes,
                idx as i32
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clear_combatants(session_id: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM combatants WHERE session_id = ?1",
        rusqlite::params![session_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE session_state SET current_turn = 0, round = 1 WHERE session_id = ?1",
        rusqlite::params![session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_combat_state(
    session_id: String,
    state: State<AppState>,
) -> Result<SessionCombatState, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT current_turn, round, custom_conditions FROM session_state WHERE session_id = ?1",
        rusqlite::params![session_id],
        |row| {
            let custom_json: String = row.get(2)?;
            let custom: Vec<String> = serde_json::from_str(&custom_json).unwrap_or_default();
            Ok(SessionCombatState {
                session_id: session_id.clone(),
                current_turn: row.get(0)?,
                round: row.get(1)?,
                custom_conditions: custom,
            })
        },
    );

    match result {
        Ok(s) => Ok(s),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(SessionCombatState {
            session_id,
            current_turn: 0,
            round: 1,
            custom_conditions: vec![],
        }),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn set_combat_state(
    session_id: String,
    current_turn: i32,
    round: i32,
    custom_conditions: Vec<String>,
    state: State<AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let custom_json = serde_json::to_string(&custom_conditions).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "INSERT INTO session_state (session_id, current_turn, round, custom_conditions)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(session_id) DO UPDATE SET
             current_turn = excluded.current_turn,
             round = excluded.round,
             custom_conditions = excluded.custom_conditions",
        rusqlite::params![session_id, current_turn, round, custom_json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

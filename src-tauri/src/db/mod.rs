use rusqlite::{Connection, Result};
use std::path::PathBuf;

pub fn get_app_data_dir() -> PathBuf {
    let base = dirs::data_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join(".local/share")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("dnd-orchestrator")
}

pub fn init(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS assets (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            asset_type TEXT NOT NULL,
            thumbnail_path TEXT,
            tags TEXT DEFAULT '[]',
            created_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS soundboard_slots (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            slot_position INTEGER NOT NULL,
            asset_id TEXT NOT NULL,
            label TEXT,
            volume REAL DEFAULT 1.0,
            loop_enabled INTEGER DEFAULT 0,
            hotkey TEXT,
            color TEXT,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS display_presets (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            name TEXT NOT NULL,
            asset_id TEXT NOT NULL,
            fog_of_war_state TEXT,
            zoom_level REAL DEFAULT 1.0,
            pan_x REAL DEFAULT 0.0,
            pan_y REAL DEFAULT 0.0,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS guion (
            session_id TEXT PRIMARY KEY,
            content TEXT DEFAULT '',
            updated_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        ",
    )?;

    Ok(())
}

pub fn open() -> Result<Connection> {
    let app_dir = get_app_data_dir();
    std::fs::create_dir_all(&app_dir).ok();
    let db_path = app_dir.join("orchestrator.db");
    let conn = Connection::open(db_path)?;
    init(&conn)?;
    Ok(conn)
}

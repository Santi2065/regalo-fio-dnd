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

        CREATE TABLE IF NOT EXISTS combatants (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            name TEXT NOT NULL,
            initiative INTEGER NOT NULL,
            hp INTEGER NOT NULL,
            max_hp INTEGER NOT NULL,
            type TEXT NOT NULL,
            conditions TEXT DEFAULT '[]',
            notes TEXT DEFAULT '',
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS session_state (
            session_id TEXT PRIMARY KEY,
            current_turn INTEGER DEFAULT 0,
            round INTEGER DEFAULT 1,
            custom_conditions TEXT DEFAULT '[]',
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        -- Knowledge Base (v1.2): manuales con búsqueda semántica
        CREATE TABLE IF NOT EXISTS manuals (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            page_count INTEGER,
            language TEXT,
            indexed_at TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS manual_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            manual_id TEXT NOT NULL,
            page_number INTEGER NOT NULL,
            chunk_index INTEGER NOT NULL,
            text TEXT NOT NULL,
            section_path TEXT,
            embedding BLOB,
            FOREIGN KEY (manual_id) REFERENCES manuals(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_chunks_manual ON manual_chunks(manual_id);

        CREATE TABLE IF NOT EXISTS stat_blocks (
            id TEXT PRIMARY KEY,
            manual_id TEXT NOT NULL,
            name TEXT NOT NULL,
            name_normalized TEXT NOT NULL,
            page_number INTEGER NOT NULL,
            data TEXT NOT NULL,
            FOREIGN KEY (manual_id) REFERENCES manuals(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_stat_blocks_name ON stat_blocks(name_normalized);
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

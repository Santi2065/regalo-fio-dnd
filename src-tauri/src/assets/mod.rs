use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Asset {
    pub id: String,
    pub session_id: Option<String>,
    pub name: String,
    pub file_path: String,
    pub asset_type: String,
    pub thumbnail_path: Option<String>,
    pub tags: Vec<String>,
    pub created_at: String,
}

fn detect_asset_type(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" => "image",
        "mp3" | "wav" | "ogg" | "flac" | "m4a" | "aac" => "audio",
        "pdf" => "document",
        "mp4" | "webm" | "mov" | "avi" => "video",
        _ => "document",
    }
}

fn generate_thumbnail(src: &Path, dest_dir: &Path, asset_id: &str) -> Option<String> {
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if !matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp"
    ) {
        return None;
    }

    let thumb_path = dest_dir.join(format!("{asset_id}_thumb.jpg"));
    if let Ok(img) = image::open(src) {
        let thumb = img.thumbnail(256, 256);
        if thumb.save(&thumb_path).is_ok() {
            return thumb_path.to_str().map(String::from);
        }
    }
    None
}

type RawRow = (
    String,
    Option<String>,
    String,
    String,
    String,
    Option<String>,
    String,
    String,
);

fn row_to_asset(
    (id, sid, name, file_path, asset_type, thumbnail_path, tags_json, created_at): RawRow,
) -> Asset {
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    Asset {
        id,
        session_id: sid,
        name,
        file_path,
        asset_type,
        thumbnail_path,
        tags,
        created_at,
    }
}

fn fetch_assets(
    conn: &rusqlite::Connection,
    session_id: &Option<String>,
    asset_type_filter: &Option<String>,
) -> Result<Vec<Asset>, String> {
    // Build SQL depending on whether we want session-scoped or global assets
    let where_scope = if session_id.is_some() {
        "session_id = ?1"
    } else {
        "session_id IS NULL"
    };

    let sql = match asset_type_filter {
        Some(_) => format!(
            "SELECT id, session_id, name, file_path, asset_type, thumbnail_path, tags, created_at
             FROM assets WHERE {where_scope} AND asset_type = ?2 ORDER BY created_at DESC"
        ),
        None => format!(
            "SELECT id, session_id, name, file_path, asset_type, thumbnail_path, tags, created_at
             FROM assets WHERE {where_scope} ORDER BY created_at DESC"
        ),
    };

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let map_row = |row: &rusqlite::Row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, String>(7)?,
        ))
    };

    let rows: Vec<RawRow> = match (session_id, asset_type_filter) {
        (Some(sid), Some(filter)) => stmt
            .query_map(rusqlite::params![sid, filter], map_row)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect(),
        (Some(sid), None) => stmt
            .query_map(rusqlite::params![sid], map_row)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect(),
        (None, Some(filter)) => stmt
            .query_map(rusqlite::params![filter], map_row)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect(),
        (None, None) => stmt
            .query_map([], map_row)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect(),
    };

    Ok(rows.into_iter().map(row_to_asset).collect())
}

#[tauri::command]
pub fn get_assets(
    session_id: Option<String>,
    asset_type_filter: Option<String>,
    state: State<AppState>,
) -> Result<Vec<Asset>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    fetch_assets(&conn, &session_id, &asset_type_filter)
}

#[tauri::command]
pub fn import_assets(
    session_id: Option<String>,
    file_paths: Vec<String>,
    state: State<AppState>,
) -> Result<Vec<Asset>, String> {
    let dest_dir = if let Some(ref sid) = session_id {
        crate::db::get_app_data_dir()
            .join("sessions")
            .join(sid)
            .join("assets")
    } else {
        crate::db::get_app_data_dir().join("global_assets")
    };
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let thumbs_dir = dest_dir.join("thumbnails");
    std::fs::create_dir_all(&thumbs_dir).ok();

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let mut created = Vec::new();

    for path_str in &file_paths {
        let src = Path::new(path_str);
        if !src.exists() {
            continue;
        }

        let id = uuid::Uuid::new_v4().to_string();
        let file_name = src
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");
        let asset_type = detect_asset_type(src);

        let dest = dest_dir.join(format!("{id}_{file_name}"));
        std::fs::copy(src, &dest).map_err(|e| format!("Copy failed for {path_str}: {e}"))?;

        let dest_str = dest.to_string_lossy().to_string();
        let thumbnail_path = generate_thumbnail(src, &thumbs_dir, &id);

        conn.execute(
            "INSERT INTO assets (id, session_id, name, file_path, asset_type, thumbnail_path, tags, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, '[]', ?7)",
            rusqlite::params![id, session_id, file_name, dest_str, asset_type, thumbnail_path, now],
        ).map_err(|e| e.to_string())?;

        created.push(Asset {
            id,
            session_id: session_id.clone(),
            name: file_name.to_string(),
            file_path: dest_str,
            asset_type: asset_type.to_string(),
            thumbnail_path,
            tags: vec![],
            created_at: now.clone(),
        });
    }

    Ok(created)
}

#[tauri::command]
pub fn update_asset(
    id: String,
    name: String,
    tags: Vec<String>,
    asset_type: Option<String>,
    state: State<AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string());
    if let Some(ref atype) = asset_type {
        conn.execute(
            "UPDATE assets SET name = ?1, tags = ?2, asset_type = ?3 WHERE id = ?4",
            rusqlite::params![name, tags_json, atype, id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE assets SET name = ?1, tags = ?2 WHERE id = ?3",
            rusqlite::params![name, tags_json, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_asset(id: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let paths: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT file_path, thumbnail_path FROM assets WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();

    conn.execute("DELETE FROM assets WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;

    if let Some((file_path, thumb_path)) = paths {
        std::fs::remove_file(&file_path).ok();
        if let Some(thumb) = thumb_path {
            std::fs::remove_file(&thumb).ok();
        }
    }

    Ok(())
}

//! Knowledge Base — manual ingestion + search.
//!
//! Phase A.1 (current): PDF copy + per-page text extraction + chunk storage +
//! substring search. No embeddings yet (the BLOB column stays NULL).
//!
//! Phase A.2 (future): add `fastembed` to compute embeddings per chunk at
//! import time and switch search to cosine similarity. The DB schema and the
//! command surface already reserve the spots so Phase A.2 is purely additive.

use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager, State};
use unicode_normalization::UnicodeNormalization;

use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Manual {
    pub id: String,
    pub name: String,
    pub file_path: String,
    pub page_count: Option<i32>,
    pub language: Option<String>,
    pub indexed_at: Option<String>,
    pub created_at: String,
    pub chunk_count: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchHit {
    pub manual_id: String,
    pub manual_name: String,
    pub page_number: i32,
    pub section_path: Option<String>,
    pub text: String,
    pub score: f32,
}

#[derive(Debug, Serialize, Clone)]
struct ImportProgress {
    job_id: String,
    phase: String,
    percent: u32,
    status_text: String,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn normalize(s: &str) -> String {
    // NFD descompone "á" → "a" + combining-acute. Filtramos los combining marks
    // (rangos Unicode estándar) y bajamos a minúsculas. No requiere cargar
    // tablas del crate de unicode-normalization más allá del decompose.
    fn is_combining(c: char) -> bool {
        matches!(
            c as u32,
            0x0300..=0x036F   // Combining Diacritical Marks
            | 0x1AB0..=0x1AFF // Combining Diacritical Marks Extended
            | 0x1DC0..=0x1DFF // Combining Diacritical Marks Supplement
            | 0x20D0..=0x20FF // Combining Diacritical Marks for Symbols
            | 0xFE20..=0xFE2F // Combining Half Marks
        )
    }
    s.nfd()
        .filter(|c| !is_combining(*c))
        .flat_map(|c| c.to_lowercase())
        .collect()
}

// ── Listing / deletion ──────────────────────────────────────────────────────

#[tauri::command]
pub fn get_manuals(state: State<AppState>) -> Result<Vec<Manual>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT m.id, m.name, m.file_path, m.page_count, m.language, m.indexed_at,
                    m.created_at,
                    (SELECT COUNT(*) FROM manual_chunks WHERE manual_id = m.id) AS chunks
             FROM manuals m
             ORDER BY m.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Manual {
                id: row.get(0)?,
                name: row.get(1)?,
                file_path: row.get(2)?,
                page_count: row.get(3)?,
                language: row.get(4)?,
                indexed_at: row.get(5)?,
                created_at: row.get(6)?,
                chunk_count: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

#[tauri::command]
pub fn delete_manual(id: String, state: State<AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let file_path: Option<String> = conn
        .query_row(
            "SELECT file_path FROM manuals WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .ok();

    conn.execute("DELETE FROM manuals WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;

    if let Some(path) = file_path {
        std::fs::remove_file(&path).ok();
    }

    Ok(())
}

// ── Search ──────────────────────────────────────────────────────────────────
//
// Phase A.1 implementation: substring match (case + accent-insensitive) over
// the chunk text, ranked by number of occurrences. Cheap and works without
// any model loaded. Phase A.2 will switch to cosine similarity over
// embedding vectors stored in `manual_chunks.embedding` (currently NULL).

#[tauri::command]
pub fn search_manuals(
    query: String,
    limit: u32,
    manual_filter: Option<Vec<String>>,
    state: State<AppState>,
) -> Result<Vec<SearchHit>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }
    let needle = normalize(trimmed);
    let needle_terms: Vec<&str> = needle.split_whitespace().collect();
    if needle_terms.is_empty() {
        return Ok(vec![]);
    }

    let conn = state.db.lock().map_err(|e| e.to_string())?;

    // Pull all chunks (with manual filter if given). For 10 manuals × 12k
    // chunks total, this fits comfortably in memory and keeps the query
    // simple — we re-rank in Rust where unicode-aware matching lives.
    let (sql, params): (String, Vec<rusqlite::types::Value>) = match manual_filter {
        Some(ids) if !ids.is_empty() => {
            let placeholders = (1..=ids.len())
                .map(|i| format!("?{i}"))
                .collect::<Vec<_>>()
                .join(",");
            (
                format!(
                    "SELECT c.manual_id, m.name, c.page_number, c.section_path, c.text
                     FROM manual_chunks c JOIN manuals m ON m.id = c.manual_id
                     WHERE c.manual_id IN ({placeholders})"
                ),
                ids.into_iter().map(rusqlite::types::Value::from).collect(),
            )
        }
        _ => (
            "SELECT c.manual_id, m.name, c.page_number, c.section_path, c.text
             FROM manual_chunks c JOIN manuals m ON m.id = c.manual_id"
                .to_string(),
            vec![],
        ),
    };

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows: Vec<(String, String, i32, Option<String>, String)> = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut hits: Vec<SearchHit> = rows
        .into_iter()
        .filter_map(|(manual_id, manual_name, page, section, text)| {
            let normalized_text = normalize(&text);
            let score: f32 = needle_terms
                .iter()
                .map(|term| normalized_text.matches(term).count() as f32)
                .sum();
            if score == 0.0 {
                return None;
            }
            // Boost for full-phrase match
            let phrase_boost = if normalized_text.contains(&needle) {
                2.0
            } else {
                0.0
            };
            Some(SearchHit {
                manual_id,
                manual_name,
                page_number: page,
                section_path: section,
                text,
                score: score + phrase_boost,
            })
        })
        .collect();

    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    hits.truncate(limit.max(1) as usize);

    Ok(hits)
}

// ── Import pipeline ─────────────────────────────────────────────────────────
//
// Async command. Extracts text per page, chunks it, and stores chunks. Emits
// `manual-import-progress` events so the UI can show a progress bar.

#[tauri::command]
pub async fn import_manual(
    file_path: String,
    name: Option<String>,
    app: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();
    let manual_id = uuid::Uuid::new_v4().to_string();

    let src = Path::new(&file_path);
    if !src.exists() {
        return Err(format!("File not found: {file_path}"));
    }
    let display_name = name.unwrap_or_else(|| {
        src.file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or("Manual")
            .to_string()
    });

    // Copy to local data dir before any further work.
    let dest_dir = crate::db::get_app_data_dir().join("manuals");
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let dest = dest_dir.join(format!("{manual_id}.pdf"));
    std::fs::copy(src, &dest)
        .map_err(|e| format!("Copy failed: {e}"))?;
    let dest_str = dest.to_string_lossy().to_string();

    // Insert the manual row right away so the UI can show it as "indexing".
    let timestamp = now();
    {
        let state: State<AppState> = app.state();
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO manuals (id, name, file_path, page_count, language, indexed_at, created_at)
             VALUES (?1, ?2, ?3, NULL, NULL, NULL, ?4)",
            rusqlite::params![manual_id, display_name, dest_str, timestamp],
        )
        .map_err(|e| e.to_string())?;
    }

    // Spawn the heavy work on a blocking thread (pdf-extract is sync).
    let job_id_clone = job_id.clone();
    let manual_id_clone = manual_id.clone();
    let app_clone = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = run_import_pipeline(&app_clone, &job_id_clone, &manual_id_clone, &dest_str)
        {
            let _ = app_clone.emit(
                "manual-import-progress",
                ImportProgress {
                    job_id: job_id_clone.clone(),
                    phase: "error".into(),
                    percent: 0,
                    status_text: e,
                },
            );
        }
    });

    Ok(job_id)
}

fn run_import_pipeline(
    app: &AppHandle,
    job_id: &str,
    manual_id: &str,
    file_path: &str,
) -> Result<(), String> {
    let emit = |phase: &str, percent: u32, status: &str| {
        let _ = app.emit(
            "manual-import-progress",
            ImportProgress {
                job_id: job_id.to_string(),
                phase: phase.to_string(),
                percent,
                status_text: status.to_string(),
            },
        );
    };

    emit("extracting", 5, "Extrayendo texto del PDF...");

    // pdf-extract returns a single string with form-feed (\x0c) between pages.
    let raw = pdf_extract::extract_text(file_path)
        .map_err(|e| format!("PDF extract failed: {e}"))?;
    let pages: Vec<&str> = raw.split('\x0c').collect();
    let page_count = pages.len() as i32;

    emit("chunking", 35, &format!("Procesando {} páginas...", page_count));

    let mut chunks: Vec<(i32, i32, String, Option<String>)> = Vec::new();
    for (idx, page) in pages.iter().enumerate() {
        if page.trim().is_empty() {
            continue;
        }
        for (chunk_idx, (text, section)) in chunk_page(page).into_iter().enumerate() {
            chunks.push((idx as i32 + 1, chunk_idx as i32, text, section));
        }
    }

    emit("inserting", 70, &format!("Guardando {} fragmentos...", chunks.len()));

    let state: State<AppState> = app.state();
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (page_number, chunk_index, text, section) in &chunks {
        tx.execute(
            "INSERT INTO manual_chunks
             (manual_id, page_number, chunk_index, text, section_path, embedding)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
            rusqlite::params![manual_id, page_number, chunk_index, text, section],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.execute(
        "UPDATE manuals SET page_count = ?1, indexed_at = ?2 WHERE id = ?3",
        rusqlite::params![page_count, now(), manual_id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    emit("done", 100, &format!("Listo · {} fragmentos indexados", chunks.len()));
    Ok(())
}

/// Naive page-level chunker: splits by paragraphs, then merges into ~500-char
/// windows with 50-char overlap. Detects section path from the first line if
/// it looks like a heading (all-caps, short, or numbered).
fn chunk_page(page: &str) -> Vec<(String, Option<String>)> {
    const TARGET: usize = 500;
    const OVERLAP: usize = 50;

    let mut section: Option<String> = None;
    let lines: Vec<&str> = page.lines().collect();
    if let Some(first) = lines.first() {
        let trimmed = first.trim();
        let is_heading = trimmed.len() < 80
            && (trimmed.chars().all(|c| c.is_uppercase() || !c.is_alphabetic())
                || trimmed.starts_with(|c: char| c.is_ascii_digit())
                || trimmed.ends_with(':'));
        if is_heading && !trimmed.is_empty() {
            section = Some(trimmed.to_string());
        }
    }

    let body: String = page.split_whitespace().collect::<Vec<_>>().join(" ");
    if body.is_empty() {
        return vec![];
    }

    let mut chunks: Vec<(String, Option<String>)> = Vec::new();
    let mut start = 0usize;
    let chars: Vec<char> = body.chars().collect();

    while start < chars.len() {
        let end = (start + TARGET).min(chars.len());
        let mut slice_end = end;
        // Try to break on a space within the last ~80 chars to avoid mid-word.
        if slice_end < chars.len() {
            let look_start = slice_end.saturating_sub(80);
            for i in (look_start..slice_end).rev() {
                if chars[i].is_whitespace() {
                    slice_end = i;
                    break;
                }
            }
        }
        let chunk_text: String = chars[start..slice_end].iter().collect();
        chunks.push((chunk_text.trim().to_string(), section.clone()));

        if slice_end >= chars.len() {
            break;
        }
        start = slice_end.saturating_sub(OVERLAP);
    }

    chunks
}

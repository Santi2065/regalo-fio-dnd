//! Knowledge Base — manual ingestion + search.
//!
//! Phase A.2 (current): PDF copy + per-page text extraction + chunking +
//! embedding (multilingual MiniLM via fastembed) + cosine similarity search.
//! Falls back to substring scoring when chunks don't have embeddings yet
//! (e.g. manuals indexed before the embedder was wired up).
//!
//! The embedder model is downloaded once on first use (~120MB) and cached on
//! disk by fastembed. Subsequent imports reuse the cached model with no
//! network access.

use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, State};
use unicode_normalization::UnicodeNormalization;

use crate::AppState;

// ── Embedder ────────────────────────────────────────────────────────────────
//
// One process-wide instance, lazily initialized on first use. The first call
// downloads the model (~120MB) which can take a few minutes on slow links;
// callers should set their UI to a "downloading" state before invoking.

static EMBEDDER: OnceLock<Mutex<TextEmbedding>> = OnceLock::new();

const EMBEDDING_DIM: usize = 384;

fn embedder() -> Result<&'static Mutex<TextEmbedding>, String> {
    if let Some(m) = EMBEDDER.get() {
        return Ok(m);
    }
    let model = TextEmbedding::try_new(
        InitOptions::new(EmbeddingModel::ParaphraseMLMiniLML12V2)
            .with_show_download_progress(false),
    )
    .map_err(|e| format!("Failed to initialize embedder: {e}"))?;
    let _ = EMBEDDER.set(Mutex::new(model));
    EMBEDDER.get().ok_or_else(|| "Embedder lost".to_string())
}

fn embed_batch(texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    let m = embedder()?;
    let mut guard = m.lock().map_err(|e| e.to_string())?;
    guard
        .embed(texts.to_vec(), None)
        .map_err(|e| format!("Embedding failed: {e}"))
}

fn vec_to_blob(v: &[f32]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(v.len() * 4);
    for f in v {
        buf.extend_from_slice(&f.to_le_bytes());
    }
    buf
}

fn blob_to_vec(b: &[u8]) -> Option<Vec<f32>> {
    if b.len() % 4 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(b.len() / 4);
    for chunk in b.chunks_exact(4) {
        out.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Some(out)
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0f32;
    let mut na = 0f32;
    let mut nb = 0f32;
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    let denom = (na.sqrt() * nb.sqrt()).max(1e-8);
    dot / denom
}

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
    pub manual_file_path: String,
    pub page_number: i32,
    pub section_path: Option<String>,
    pub text: String,
    pub score: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StatBlock {
    pub id: String,
    pub manual_id: String,
    pub manual_name: String,
    pub manual_file_path: String,
    pub name: String,
    pub page_number: i32,
    /// Texto crudo del stat block tal como vino del PDF, ya con
    /// whitespace colapsado pero preservando saltos de línea para
    /// que el frontend lo renderice como pre-formatted.
    pub raw_text: String,
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

// ── Stat block lookup ───────────────────────────────────────────────────────
//
// Match flexible: el nombre del combatiente que ingresa el DM puede variar
// ("Goblin", "Goblin 1", "Goblin Boss"). Probamos exact match primero,
// después prefix match, después substring. Devolvemos el primer hit.

#[tauri::command]
pub fn get_stat_block_by_name(
    name: String,
    state: State<AppState>,
) -> Result<Option<StatBlock>, String> {
    let needle = normalize(&name);
    let words: Vec<&str> = needle.split_whitespace().collect();
    if words.is_empty() {
        return Ok(None);
    }
    let primary = words.first().copied().unwrap_or("");

    let conn = state.db.lock().map_err(|e| e.to_string())?;

    // 1) Exact match sobre toda la frase normalizada
    let exact = conn.query_row(
        "SELECT s.id, s.manual_id, m.name, m.file_path, s.name, s.page_number, s.data
         FROM stat_blocks s JOIN manuals m ON m.id = s.manual_id
         WHERE s.name_normalized = ?1
         LIMIT 1",
        rusqlite::params![needle],
        |row| {
            Ok(StatBlock {
                id: row.get(0)?,
                manual_id: row.get(1)?,
                manual_name: row.get(2)?,
                manual_file_path: row.get(3)?,
                name: row.get(4)?,
                page_number: row.get(5)?,
                raw_text: row.get(6)?,
            })
        },
    );
    if let Ok(sb) = exact {
        return Ok(Some(sb));
    }

    // 2) Match por la primera palabra (cubre "Goblin 1" → "Goblin")
    let by_first_word = conn.query_row(
        "SELECT s.id, s.manual_id, m.name, m.file_path, s.name, s.page_number, s.data
         FROM stat_blocks s JOIN manuals m ON m.id = s.manual_id
         WHERE s.name_normalized = ?1
         LIMIT 1",
        rusqlite::params![primary],
        |row| {
            Ok(StatBlock {
                id: row.get(0)?,
                manual_id: row.get(1)?,
                manual_name: row.get(2)?,
                manual_file_path: row.get(3)?,
                name: row.get(4)?,
                page_number: row.get(5)?,
                raw_text: row.get(6)?,
            })
        },
    );
    if let Ok(sb) = by_first_word {
        return Ok(Some(sb));
    }

    // 3) Substring sobre la primera palabra (cubre "Goblins" o "Beholder Zombie")
    let like_pattern = format!("%{primary}%");
    let by_substr = conn.query_row(
        "SELECT s.id, s.manual_id, m.name, m.file_path, s.name, s.page_number, s.data
         FROM stat_blocks s JOIN manuals m ON m.id = s.manual_id
         WHERE s.name_normalized LIKE ?1
         ORDER BY length(s.name) ASC
         LIMIT 1",
        rusqlite::params![like_pattern],
        |row| {
            Ok(StatBlock {
                id: row.get(0)?,
                manual_id: row.get(1)?,
                manual_name: row.get(2)?,
                manual_file_path: row.get(3)?,
                name: row.get(4)?,
                page_number: row.get(5)?,
                raw_text: row.get(6)?,
            })
        },
    );
    Ok(by_substr.ok())
}

// ── Search ──────────────────────────────────────────────────────────────────
//
// Hybrid: chunks with embeddings get cosine similarity ranking; chunks
// without (legacy or pending re-embedding) fall back to substring score
// from Phase A.1. Both axes feed the same final ranking so the experience
// is consistent.

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

    // Try to embed the query. If the embedder isn't ready (e.g. no model
    // downloaded yet), we silently fall back to substring-only scoring.
    let query_embedding: Option<Vec<f32>> = embed_batch(&[trimmed.to_string()])
        .ok()
        .and_then(|mut v| v.pop());

    let rows = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let (sql, params): (String, Vec<rusqlite::types::Value>) = match manual_filter {
            Some(ids) if !ids.is_empty() => {
                let placeholders = (1..=ids.len())
                    .map(|i| format!("?{i}"))
                    .collect::<Vec<_>>()
                    .join(",");
                (
                    format!(
                        "SELECT c.manual_id, m.name, c.page_number, c.section_path, c.text, c.embedding
                         FROM manual_chunks c JOIN manuals m ON m.id = c.manual_id
                         WHERE c.manual_id IN ({placeholders})"
                    ),
                    ids.into_iter().map(rusqlite::types::Value::from).collect(),
                )
            }
            _ => (
                "SELECT c.manual_id, m.name, m.file_path, c.page_number, c.section_path, c.text, c.embedding
                 FROM manual_chunks c JOIN manuals m ON m.id = c.manual_id"
                    .to_string(),
                vec![],
            ),
        };

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let collected: Vec<(
            String,
            String,
            String,
            i32,
            Option<String>,
            String,
            Option<Vec<u8>>,
        )> = stmt
            .query_map(rusqlite::params_from_iter(params.iter()), |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get::<_, Option<Vec<u8>>>(6)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        collected
    };

    let mut hits: Vec<SearchHit> = rows
        .into_iter()
        .filter_map(|(manual_id, manual_name, manual_file_path, page, section, text, emb_blob)| {
            let mut score = 0f32;

            // Semantic score: cosine similarity if both query and chunk are
            // embedded. Cosine in [-1, 1] → map to [0, 10] for the final mix.
            if let (Some(qe), Some(blob)) = (query_embedding.as_ref(), emb_blob.as_ref()) {
                if let Some(ce) = blob_to_vec(blob) {
                    let cs = cosine_similarity(qe, &ce);
                    if cs > 0.25 {
                        score += cs * 10.0;
                    }
                }
            }

            // Substring score: keeps lexical hits (proper nouns, numbers,
            // multi-word phrases) on top even when the embedding doesn't
            // capture them.
            let normalized_text = normalize(&text);
            let lex: f32 = needle_terms
                .iter()
                .map(|term| normalized_text.matches(term).count() as f32)
                .sum();
            score += lex;
            if normalized_text.contains(&needle) {
                score += 2.0;
            }

            if score < 0.5 {
                return None;
            }
            Some(SearchHit {
                manual_id,
                manual_name,
                manual_file_path,
                page_number: page,
                section_path: section,
                text,
                score,
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

    emit("chunking", 25, &format!("Procesando {} páginas...", page_count));

    let mut chunks: Vec<(i32, i32, String, Option<String>)> = Vec::new();
    for (idx, page) in pages.iter().enumerate() {
        if page.trim().is_empty() {
            continue;
        }
        for (chunk_idx, (text, section)) in chunk_page(page).into_iter().enumerate() {
            chunks.push((idx as i32 + 1, chunk_idx as i32, text, section));
        }
    }

    // Embedding phase. The first import on a fresh install downloads the
    // model (~120MB) and may take several minutes; subsequent imports use
    // the on-disk cache. We swallow embedder errors and continue with NULL
    // embeddings so the manual still indexes (search falls back to
    // substring matching) — better degraded than nothing.
    emit(
        "embedding",
        40,
        &format!(
            "Generando embeddings de {} fragmentos (la primera vez puede tardar)...",
            chunks.len()
        ),
    );

    let mut embeddings: Vec<Option<Vec<f32>>> = vec![None; chunks.len()];
    let texts: Vec<String> = chunks.iter().map(|c| c.2.clone()).collect();
    const BATCH: usize = 32;
    let batch_count = texts.len().div_ceil(BATCH);

    'embed: for (bi, batch) in texts.chunks(BATCH).enumerate() {
        let progress = 40 + ((bi as u32 * 25) / batch_count.max(1) as u32);
        emit(
            "embedding",
            progress,
            &format!("Embedding batch {}/{}", bi + 1, batch_count),
        );
        match embed_batch(&batch.to_vec()) {
            Ok(vecs) => {
                let start = bi * BATCH;
                for (i, v) in vecs.into_iter().enumerate() {
                    if v.len() == EMBEDDING_DIM {
                        embeddings[start + i] = Some(v);
                    }
                }
            }
            Err(e) => {
                // Most likely "no internet" or "model download failed". Log
                // and break — the rest of the chunks stay NULL and search
                // gracefully falls back.
                let _ = app.emit(
                    "manual-import-progress",
                    ImportProgress {
                        job_id: job_id.to_string(),
                        phase: "embedding".into(),
                        percent: progress,
                        status_text: format!(
                            "Embedder no disponible ({e}); se indexa sin búsqueda semántica"
                        ),
                    },
                );
                break 'embed;
            }
        }
    }

    emit("inserting", 75, &format!("Guardando {} fragmentos...", chunks.len()));

    // Stat block detection: ejecutar antes de la transacción porque solo
    // necesita el page_text crudo. El resultado se persiste en la misma tx
    // que los chunks.
    emit("stat_blocks", 85, "Detectando stat blocks...");
    let mut detected_stat_blocks: Vec<(String, String, i32, String)> = Vec::new();
    for (idx, page) in pages.iter().enumerate() {
        if page.trim().is_empty() {
            continue;
        }
        for (sb_id, sb_name, sb_text) in
            detect_stat_blocks_in_page(page, idx as i32 + 1, manual_id)
        {
            detected_stat_blocks.push((sb_id, sb_name, idx as i32 + 1, sb_text));
        }
    }

    let state: State<AppState> = app.state();
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (i, (page_number, chunk_index, text, section)) in chunks.iter().enumerate() {
        let blob: Option<Vec<u8>> = embeddings[i].as_ref().map(|v| vec_to_blob(v));
        tx.execute(
            "INSERT INTO manual_chunks
             (manual_id, page_number, chunk_index, text, section_path, embedding)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![manual_id, page_number, chunk_index, text, section, blob],
        )
        .map_err(|e| e.to_string())?;
    }

    // Persist stat blocks. El campo `data` guarda el text raw para que el
    // frontend lo renderice; en futuras fases podríamos parsear sub-estructura.
    for (sb_id, sb_name, sb_page, sb_text) in &detected_stat_blocks {
        let normalized = normalize(sb_name);
        tx.execute(
            "INSERT OR REPLACE INTO stat_blocks
             (id, manual_id, name, name_normalized, page_number, data)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![sb_id, manual_id, sb_name, normalized, sb_page, sb_text],
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

// ── Stat block detection ────────────────────────────────────────────────────
//
// Heurística simple para D&D 5e + Pathfinder: un stat block arranca con un
// nombre corto en una línea + dentro de las próximas 5 líneas tiene "Armor
// Class" y "Hit Points". Capturamos desde el nombre hasta que aparece otro
// nombre con la misma firma o termina la página. No pretendemos parsear el
// JSON estructurado — guardamos el bloque raw y el frontend lo renderiza
// pre-formatted. La estructura completa puede sumarse después sin migrar.

fn detect_stat_blocks_in_page(
    page_text: &str,
    page_number: i32,
    manual_id: &str,
) -> Vec<(String, String, String)> {
    // Returns (stable_id, name, raw_text)
    let lines: Vec<&str> = page_text.lines().collect();
    if lines.is_empty() {
        return vec![];
    }

    // Find anchor lines: lines containing "Armor Class" + a number.
    let mut anchors: Vec<usize> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let lower = line.to_lowercase();
        if (lower.contains("armor class") || lower.contains("clase de armadura"))
            && line.chars().any(|c| c.is_ascii_digit())
        {
            anchors.push(i);
        }
    }

    let mut found: Vec<(String, String, String)> = Vec::new();
    for &anchor in &anchors {
        // Look backwards up to 5 lines for the name (a short, mostly-letters
        // line that's not the AC line itself).
        let mut name_idx: Option<usize> = None;
        for back in 1..=5 {
            if anchor < back {
                break;
            }
            let candidate = lines[anchor - back].trim();
            if candidate.is_empty() {
                continue;
            }
            // Skip lines that look like "Medium aberration, lawful evil"
            // (size/type line that comes between name and AC).
            let lower = candidate.to_lowercase();
            if lower.starts_with("tiny ")
                || lower.starts_with("small ")
                || lower.starts_with("medium ")
                || lower.starts_with("large ")
                || lower.starts_with("huge ")
                || lower.starts_with("gargantuan ")
                || lower.starts_with("pequeño")
                || lower.starts_with("mediano")
                || lower.starts_with("grande")
            {
                continue;
            }
            // Plausible name: < 60 chars, mostly letters, not a sentence.
            let letter_count = candidate.chars().filter(|c| c.is_alphabetic()).count();
            if candidate.len() < 60
                && letter_count >= candidate.len() / 2
                && !candidate.ends_with('.')
                && !candidate.contains(',')
            {
                name_idx = Some(anchor - back);
                break;
            }
        }

        let Some(name_line) = name_idx else { continue };

        // Verify: within 5 lines after AC, expect "Hit Points".
        let mut has_hp = false;
        for j in (anchor + 1)..(anchor + 6).min(lines.len()) {
            let lower = lines[j].to_lowercase();
            if lower.contains("hit points")
                || lower.contains("puntos de golpe")
                || lower.contains("puntos de vida")
            {
                has_hp = true;
                break;
            }
        }
        if !has_hp {
            continue;
        }

        let name = lines[name_line].trim().to_string();
        if name.is_empty() {
            continue;
        }

        // Capture from name_line until the next anchor (or end of page),
        // bounded to ~80 lines as a safety cap.
        let next_anchor = anchors
            .iter()
            .find(|&&a| a > anchor + 5)
            .copied()
            .unwrap_or(lines.len());
        let next_name_idx = if next_anchor != lines.len() {
            // Walk back from next_anchor to find its name line.
            let mut nn = next_anchor;
            for back in 1..=5 {
                if next_anchor < back {
                    break;
                }
                if !lines[next_anchor - back].trim().is_empty() {
                    nn = next_anchor - back;
                }
            }
            nn
        } else {
            lines.len()
        };

        let end = next_name_idx.min(name_line + 80);
        let raw_text = lines[name_line..end]
            .iter()
            .map(|l| l.trim_end())
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string();

        if raw_text.len() < 80 {
            // Too short to be a real stat block — likely a false positive.
            continue;
        }

        let stable_id = format!("{}-p{}-{}", manual_id, page_number, name_line);
        found.push((stable_id, name, raw_text));
    }

    found
}

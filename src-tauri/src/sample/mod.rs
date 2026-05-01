use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, State};

use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SampleSession {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Bundled assets — name (visible to user) → bundle resource path.
/// Resource paths are relative to the resources/ directory in the bundle.
struct SampleAsset {
    bundle_path: &'static str,
    display_name: &'static str,
    asset_type: &'static str,
    /// Stable id used inside the bundled guión so cues match assets.
    stable_id: &'static str,
}

const SAMPLE_ASSETS: &[SampleAsset] = &[
    SampleAsset {
        bundle_path: "audio/tavern_ambient.mp3",
        display_name: "Taberna",
        asset_type: "audio",
        stable_id: "smp-aud-tavern",
    },
    SampleAsset {
        bundle_path: "audio/forest_ambient.mp3",
        display_name: "Bosque",
        asset_type: "audio",
        stable_id: "smp-aud-forest",
    },
    SampleAsset {
        bundle_path: "audio/dungeon_ambient.mp3",
        display_name: "Dungeon",
        asset_type: "audio",
        stable_id: "smp-aud-dungeon",
    },
    SampleAsset {
        bundle_path: "audio/battle_sfx.mp3",
        display_name: "Combate (SFX)",
        asset_type: "audio",
        stable_id: "smp-aud-battle",
    },
    SampleAsset {
        bundle_path: "audio/sword_clash.mp3",
        display_name: "Espadazo",
        asset_type: "audio",
        stable_id: "smp-aud-sword",
    },
    SampleAsset {
        bundle_path: "audio/magic_spell.mp3",
        display_name: "Hechizo",
        asset_type: "audio",
        stable_id: "smp-aud-magic",
    },
    SampleAsset {
        bundle_path: "audio/door_creak.mp3",
        display_name: "Puerta",
        asset_type: "audio",
        stable_id: "smp-aud-door",
    },
    SampleAsset {
        bundle_path: "images/castle.jpg",
        display_name: "Castillo",
        asset_type: "image",
        stable_id: "smp-img-castle",
    },
    SampleAsset {
        bundle_path: "images/dungeon_map.jpg",
        display_name: "Mapa de Mazmorra",
        asset_type: "image",
        stable_id: "smp-img-map",
    },
    SampleAsset {
        bundle_path: "images/dragon.jpg",
        display_name: "Dragón",
        asset_type: "image",
        stable_id: "smp-img-dragon",
    },
    SampleAsset {
        bundle_path: "images/treasure.jpg",
        display_name: "Tesoro",
        asset_type: "image",
        stable_id: "smp-img-treasure",
    },
];

const SAMPLE_GUION: &str = r#"# 🍻 Sesión de ejemplo — La Taberna del Dragón Dormido

> Esta es una sesión pre-armada para que veas cómo funcionan los cues, el soundboard y la proyección. Todos los assets ya están cargados — pasá a modo **Live** ▶ y probá hacer click en los cues que aparecen abajo.

---

## Escena 1: La taberna

Los aventureros entran en *La Taberna del Dragón Dormido*. El fuego cruje, una pareja de gnomos discute sobre cervezas, y el tabernero te saluda con un gesto.

%%ambient:smp-aud-tavern:Taberna%%  ← click para empezar la música de fondo

%%project:smp-img-castle:Castillo%%  ← proyectá esto en la pantalla del jugador

Una elfa de capa azul se acerca a tu mesa y dice en voz baja:

> *"Necesito que recuperen algo. Algo que un dragón se llevó. Pago bien."*

Si los jugadores aceptan, partirán al amanecer.

---

## Escena 2: El bosque

Caminan por un sendero embarrado durante todo el día. El sol se esconde y los pájaros dejan de cantar.

%%ambient:smp-aud-forest:Bosque%%  ← cambiá el ambiente al bosque

De golpe, una rama crepita. **¡Tirada de Percepción!**

---

## Escena 3: La mazmorra del dragón

Bajan por escaleras de piedra húmeda. El aire se vuelve denso.

%%ambient:smp-aud-dungeon:Dungeon%%  ← ambiente de mazmorra

%%project:smp-img-map:Mapa de Mazmorra%%  ← proyectá el mapa

%%sfx:smp-aud-door:Puerta%%  ← *la puerta se abre con un crujido*

Allí, sobre una pila de oro, duerme un dragón rojo.

%%project:smp-img-dragon:Dragón%%

---

## Escena 4: ¡Combate!

El dragón despierta. Iniciativa.

%%sfx:smp-aud-battle:Combate%%  ← stinger de combate

> Abrí la pestaña ⚔ **Iniciativa** del panel derecho — ya hay 3 combatientes precargados para que veas cómo funciona.

Cuando un PJ ataque:

%%sfx:smp-aud-sword:Espadazo%%

Cuando un mago lance un hechizo:

%%sfx:smp-aud-magic:Hechizo%%

---

## Escena 5: El tesoro

Si vencen al dragón:

%%project:smp-img-treasure:Tesoro%%

> *Los aventureros descubren un cofre con monedas, una espada rúnica y un anillo extraño.*

**Fin de la sesión de ejemplo.** Eliminala cuando quieras y armá la tuya. ✨
"#;

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn copy_sample_asset(
    app: &AppHandle,
    sample: &SampleAsset,
    session_id: &str,
    dest_dir: &Path,
    thumbs_dir: &Path,
    conn: &rusqlite::Connection,
    timestamp: &str,
) -> Result<(), String> {
    let resource_path = app
        .path()
        .resolve(sample.bundle_path, BaseDirectory::Resource)
        .map_err(|e| format!("Resource resolve failed for {}: {e}", sample.bundle_path))?;

    if !resource_path.exists() {
        return Err(format!(
            "Sample asset not found at runtime: {}",
            resource_path.display()
        ));
    }

    let file_name = Path::new(sample.bundle_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("sample.bin");
    let dest = dest_dir.join(format!("{}_{}", sample.stable_id, file_name));
    std::fs::copy(&resource_path, &dest)
        .map_err(|e| format!("Copy failed for {}: {e}", sample.bundle_path))?;

    let dest_str = dest.to_string_lossy().to_string();

    let mut thumbnail_path: Option<String> = None;
    if sample.asset_type == "image" {
        let thumb = thumbs_dir.join(format!("{}_thumb.jpg", sample.stable_id));
        if let Ok(img) = image::open(&dest) {
            let small = img.thumbnail(256, 256);
            if small.save(&thumb).is_ok() {
                thumbnail_path = thumb.to_str().map(String::from);
            }
        }
    }

    conn.execute(
        "INSERT INTO assets (id, session_id, name, file_path, asset_type, thumbnail_path, tags, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, '[\"sample\"]', ?7)",
        rusqlite::params![
            sample.stable_id,
            session_id,
            sample.display_name,
            dest_str,
            sample.asset_type,
            thumbnail_path,
            timestamp
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn seed_soundboard(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<(), String> {
    let slots: &[(i32, &str, &str, i32, &str, &str)] = &[
        // (position, asset_stable_id, label, loop_enabled, hotkey, color)
        (0, "smp-aud-tavern", "Taberna", 1, "1", "amber"),
        (1, "smp-aud-forest", "Bosque", 1, "2", "emerald"),
        (2, "smp-aud-dungeon", "Mazmorra", 1, "3", "violet"),
        (3, "smp-aud-sword", "Espadazo", 0, "4", "red"),
    ];

    for (pos, asset_id, label, loop_enabled, hotkey, color) in slots {
        let id = format!("smp-slot-{pos}");
        conn.execute(
            "INSERT INTO soundboard_slots
             (id, session_id, slot_position, asset_id, label, volume, loop_enabled, hotkey, color)
             VALUES (?1, ?2, ?3, ?4, ?5, 0.7, ?6, ?7, ?8)",
            rusqlite::params![id, session_id, pos, asset_id, label, loop_enabled, hotkey, color],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn seed_combatants(conn: &rusqlite::Connection, session_id: &str) -> Result<(), String> {
    let timestamp = now();
    let _ = timestamp; // not used in this insert path
    let combatants: &[(&str, &str, i32, i32, i32, &str)] = &[
        // (id, name, initiative, hp, max_hp, type)
        ("smp-cmb-aragorn", "Aragorn", 18, 28, 28, "player"),
        ("smp-cmb-mago", "Élric el Mago", 16, 16, 16, "player"),
        ("smp-cmb-dragon", "Dragón Rojo Joven", 14, 75, 75, "enemy"),
    ];

    for (idx, (id, name, init, hp, max_hp, kind)) in combatants.iter().enumerate() {
        conn.execute(
            "INSERT INTO combatants
             (id, session_id, name, initiative, hp, max_hp, type, conditions, notes, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '[]', '', ?8)",
            rusqlite::params![id, session_id, name, init, hp, max_hp, kind, idx as i32],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn create_sample_session(
    app: AppHandle,
    state: State<AppState>,
) -> Result<SampleSession, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let timestamp = now();
    let name = "✨ Sesión de ejemplo";
    let description = Some("Una taberna, un bosque, una mazmorra y un dragón. Probá los cues.");

    let session_dir: PathBuf = crate::db::get_app_data_dir().join("sessions").join(&id);
    let assets_dir = session_dir.join("assets");
    let thumbs_dir = assets_dir.join("thumbnails");
    std::fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&thumbs_dir).ok();

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO sessions (id, name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, name, description, timestamp, timestamp],
    ).map_err(|e| e.to_string())?;

    for sample in SAMPLE_ASSETS {
        copy_sample_asset(&app, sample, &id, &assets_dir, &thumbs_dir, &tx, &timestamp)?;
    }

    seed_soundboard(&tx, &id)?;
    seed_combatants(&tx, &id)?;

    tx.execute(
        "INSERT OR REPLACE INTO guion (session_id, content, updated_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, SAMPLE_GUION, timestamp],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(SampleSession {
        id,
        name: name.to_string(),
        description: description.map(String::from),
        created_at: timestamp.clone(),
        updated_at: timestamp,
    })
}

//! Player Web Companion — fases B.1 + B.2.
//!
//! Servidor HTTP embebido que expone una URL accesible desde la red WiFi
//! local. Los players abren la URL en el celu, eligen su PJ de una lista
//! configurable por el DM, y entran a una vista de sesión.
//!
//! Esta versión entrega:
//! - Lifecycle del server (start / stop / status)
//! - Lista de characters configurable desde el DM (companion_set_characters)
//! - Auth ligera con tokens in-memory (POST /api/connect → token; GET /api/me)
//! - Player view real (HTML+JS standalone, mobile-first) servida desde /
//! - PIN opcional de sesión + validación
//!
//! Falta para B.3:
//! - WebSocket para push de eventos al celu (handouts, fog, HP, dice)
//! - Endpoints para tirar dados desde el celu y broadcast al DM
//! - Tabs reales en la session view (Ficha / Mapa / Tirar / Notas)

use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::sync::{broadcast, oneshot};

use crate::AppState;

mod server;

const COMPANION_PORT: u16 = 47823;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Character {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CompanionInfo {
    pub url: String,
    pub local_ip: String,
    pub port: u16,
    pub pin: Option<String>,
    pub qr_svg: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConnectedPlayer {
    pub token: String,
    pub character: Character,
    /// Cuándo se conectó, en segundos desde que arrancó el server.
    pub connected_seconds_ago: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CompanionStatus {
    pub running: bool,
    pub info: Option<CompanionInfo>,
    pub characters: Vec<Character>,
    pub connected: Vec<ConnectedPlayer>,
}

/// State global del companion. None = apagado.
pub struct CompanionState {
    info: Option<CompanionInfo>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    /// Compartido con el server. Lectura/escritura desde dos lados (commands
    /// Tauri y handlers axum), por eso Mutex.
    pub public_state: Arc<StdMutex<PublicState>>,
}

/// State leído por el server axum y mutado por los comandos Tauri (excepto
/// `connections` que el server también muta cuando un player se conecta /
/// desconecta).
#[derive(Debug)]
pub struct PublicState {
    pub campaign_name: String,
    /// ID de la sesión D&D activa. Se usa para asociar chats a la sesión
    /// correcta cuando se persisten desde el HTTP handler. None mientras el
    /// companion no está corriendo.
    pub session_id: Option<String>,
    pub pin: Option<String>,
    pub characters: Vec<Character>,
    /// token → conexión. Generado por POST /api/connect.
    pub connections: HashMap<String, ServerConnection>,
    pub started_at: Option<Instant>,
    /// Broadcast channel para empujar PlayerEvents a todas las WebSocket
    /// conexiones activas. Cada handler de /ws subscribe y filtra eventos
    /// según el player target (broadcast vs privado).
    pub events: broadcast::Sender<PlayerEvent>,
}

impl Default for PublicState {
    fn default() -> Self {
        let (tx, _rx) = broadcast::channel(64);
        Self {
            campaign_name: String::new(),
            session_id: None,
            pin: None,
            characters: Vec::new(),
            connections: HashMap::new(),
            started_at: None,
            events: tx,
        }
    }
}

/// Eventos que el DM puede empujar al celu de los players.
/// `to_token == None` significa broadcast (todos los conectados); `Some(token)`
/// es un evento privado para ese player solo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PlayerEvent {
    #[serde(rename = "handout")]
    Handout {
        to_token: Option<String>,
        content: HandoutContent,
        sent_at: String,
    },
    #[serde(rename = "kicked")]
    Kicked { to_token: String },
    /// Chat: el server reenvía esto SOLO al destinatario (el handler de WS
    /// filtra por `recipient_token`). El DM recibe un evento espejo via
    /// `DmEvent::Chat` siempre, sin importar a quién va dirigido.
    #[serde(rename = "chat")]
    Chat {
        chat_id: String,
        sender_kind: String,                 // "dm" | "player"
        sender_token: Option<String>,        // None si sender_kind="dm"
        sender_name: String,
        recipient_kind: String,              // "dm" | "player"
        recipient_token: Option<String>,     // None si recipient_kind="dm"
        recipient_name: String,
        content: String,
        sent_at: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum HandoutContent {
    #[serde(rename = "text")]
    Text { title: Option<String>, body: String },
}

/// Eventos que el server le empuja al DM (a través del frontend Tauri).
/// El DM frontend escucha estos via `listen("companion-event", ...)`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum DmEvent {
    #[serde(rename = "dice_roll")]
    DiceRoll {
        from_token: String,
        from_name: String,
        expression: String,
        total: i64,
        breakdown: String,
    },
    #[serde(rename = "player_connected")]
    PlayerConnected { token: String, name: String },
    #[serde(rename = "player_disconnected")]
    PlayerDisconnected { token: String, name: String },
    /// Espejo de TODO mensaje de chat — el DM ve siempre todos los chats,
    /// incluso los que aparentan ser entre players. Esto es a propósito
    /// (los players juegan con sensación de privacidad pero el DM tiene
    /// contexto narrativo completo).
    #[serde(rename = "chat")]
    Chat {
        chat_id: String,
        sender_kind: String,
        sender_token: Option<String>,
        sender_name: String,
        recipient_kind: String,
        recipient_token: Option<String>,
        recipient_name: String,
        content: String,
        sent_at: String,
    },
}

/// Persisted chat message — same shape as the `Chat` events but in DB form.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub session_id: String,
    pub sender_kind: String,
    pub sender_token: Option<String>,
    pub sender_name: String,
    pub recipient_kind: String,
    pub recipient_token: Option<String>,
    pub recipient_name: String,
    pub content: String,
    pub sent_at: String,
}

#[derive(Debug, Clone)]
pub struct ServerConnection {
    pub character: Character,
    pub connected_at: Instant,
}

impl CompanionState {
    pub fn new() -> Self {
        Self {
            info: None,
            shutdown_tx: None,
            public_state: Arc::new(StdMutex::new(PublicState::default())),
        }
    }
}

fn detect_local_ip() -> String {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

fn make_qr_svg(url: &str) -> String {
    use qrcode::render::svg;
    use qrcode::QrCode;
    QrCode::new(url.as_bytes())
        .map(|code| {
            code.render()
                .min_dimensions(220, 220)
                .dark_color(svg::Color("#0e0a06"))
                .light_color(svg::Color("#f8f1de"))
                .build()
        })
        .unwrap_or_else(|_| "<svg></svg>".to_string())
}

fn generate_pin() -> String {
    let mut rng = rand::thread_rng();
    format!("{:04}", rng.gen_range(0..10000))
}

#[tauri::command]
pub async fn companion_start(
    session_id: String,
    pin: Option<String>,
    campaign_name: Option<String>,
    characters: Option<Vec<Character>>,
    app: AppHandle,
    state: tauri::State<'_, StdMutex<CompanionState>>,
) -> Result<CompanionInfo, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if guard.info.is_some() {
        return guard
            .info
            .clone()
            .ok_or_else(|| "Already running but info missing".to_string());
    }

    let validated_pin = pin
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .map(|p| {
            if p.len() == 4 && p.chars().all(|c| c.is_ascii_digit()) {
                Ok(p)
            } else {
                Err("PIN debe ser 4 dígitos".to_string())
            }
        })
        .transpose()?;

    {
        let mut public = guard.public_state.lock().map_err(|e| e.to_string())?;
        public.session_id = Some(session_id);
        public.campaign_name = campaign_name.unwrap_or_else(|| "Sesión D&D".to_string());
        public.pin = validated_pin.clone();
        public.characters = characters.unwrap_or_default();
        public.connections.clear();
        public.started_at = Some(Instant::now());
    }

    let local_ip = detect_local_ip();
    let url = format!("http://{}:{}", local_ip, COMPANION_PORT);
    let qr_svg = make_qr_svg(&url);

    let info = CompanionInfo {
        url: url.clone(),
        local_ip,
        port: COMPANION_PORT,
        pin: validated_pin,
        qr_svg,
    };

    let (tx, rx) = oneshot::channel::<()>();
    let public_state = guard.public_state.clone();
    let port = COMPANION_PORT;
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(e) = server::run(port, public_state, app_handle, rx).await {
            eprintln!("[companion] server error: {e}");
        }
    });

    guard.info = Some(info.clone());
    guard.shutdown_tx = Some(tx);

    Ok(info)
}

#[tauri::command]
pub fn companion_stop(
    state: tauri::State<'_, StdMutex<CompanionState>>,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = guard.shutdown_tx.take() {
        let _ = tx.send(());
    }
    guard.info = None;
    if let Ok(mut public) = guard.public_state.lock() {
        public.connections.clear();
        public.started_at = None;
        public.session_id = None;
    }
    Ok(())
}

#[tauri::command]
pub fn companion_status(
    state: tauri::State<'_, StdMutex<CompanionState>>,
) -> Result<CompanionStatus, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let public = guard.public_state.lock().map_err(|e| e.to_string())?;
    let connected: Vec<ConnectedPlayer> = public
        .connections
        .iter()
        .map(|(token, conn)| ConnectedPlayer {
            token: token.clone(),
            character: conn.character.clone(),
            connected_seconds_ago: conn.connected_at.elapsed().as_secs(),
        })
        .collect();
    Ok(CompanionStatus {
        running: guard.info.is_some(),
        info: guard.info.clone(),
        characters: public.characters.clone(),
        connected,
    })
}

#[tauri::command]
pub fn companion_set_characters(
    characters: Vec<Character>,
    state: tauri::State<'_, StdMutex<CompanionState>>,
) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let mut public = guard.public_state.lock().map_err(|e| e.to_string())?;
    public.characters = characters;
    Ok(())
}

#[tauri::command]
pub fn companion_kick_player(
    token: String,
    state: tauri::State<'_, StdMutex<CompanionState>>,
) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let mut public = guard.public_state.lock().map_err(|e| e.to_string())?;
    public.connections.remove(&token);
    let _ = public.events.send(PlayerEvent::Kicked {
        to_token: token,
    });
    Ok(())
}

#[tauri::command]
pub fn companion_send_handout(
    to_token: Option<String>,
    title: Option<String>,
    body: String,
    state: tauri::State<'_, StdMutex<CompanionState>>,
) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let public = guard.public_state.lock().map_err(|e| e.to_string())?;
    if !guard.info.is_some() {
        return Err("Companion no está activo".to_string());
    }
    if let Some(ref t) = to_token {
        if !public.connections.contains_key(t) {
            return Err("El player ya no está conectado".to_string());
        }
    }
    let event = PlayerEvent::Handout {
        to_token,
        content: HandoutContent::Text { title, body },
        sent_at: chrono::Utc::now().to_rfc3339(),
    };
    let _ = public.events.send(event);
    Ok(())
}

#[tauri::command]
pub fn companion_generate_pin() -> String {
    generate_pin()
}

// ── Chat commands ────────────────────────────────────────────────────────────

/// El DM manda un mensaje a un player específico (o "dm-self" si quiere
/// guardarse una nota propia, aunque eso es raro). Persiste a DB, broadcast
/// como `PlayerEvent::Chat` (filtrado por el WS handler para que solo lo
/// reciba el destinatario), y emite `DmEvent::Chat` al frontend desktop
/// como espejo (el DM ve su propio mensaje).
#[tauri::command]
pub fn companion_send_chat(
    session_id: String,
    recipient_token: String,
    content: String,
    app: AppHandle,
    state: tauri::State<'_, StdMutex<CompanionState>>,
    app_state: tauri::State<'_, AppState>,
) -> Result<ChatMessage, String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err("Mensaje vacío".to_string());
    }
    if trimmed.len() > 2000 {
        return Err("Mensaje demasiado largo (máx 2000 caracteres)".to_string());
    }

    let guard = state.lock().map_err(|e| e.to_string())?;
    if guard.info.is_none() {
        return Err("Companion no está activo".to_string());
    }

    let public = guard.public_state.lock().map_err(|e| e.to_string())?;
    let recipient_name = public
        .connections
        .get(&recipient_token)
        .map(|c| c.character.name.clone())
        .ok_or_else(|| "El player ya no está conectado".to_string())?;

    let msg = ChatMessage {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: session_id.clone(),
        sender_kind: "dm".to_string(),
        sender_token: None,
        sender_name: "DM".to_string(),
        recipient_kind: "player".to_string(),
        recipient_token: Some(recipient_token.clone()),
        recipient_name: recipient_name.clone(),
        content: trimmed.to_string(),
        sent_at: chrono::Utc::now().to_rfc3339(),
    };

    persist_chat(&app_state, &msg)?;

    // Push al celu del destinatario (filtrado por WS handler).
    let _ = public.events.send(PlayerEvent::Chat {
        chat_id: msg.id.clone(),
        sender_kind: msg.sender_kind.clone(),
        sender_token: msg.sender_token.clone(),
        sender_name: msg.sender_name.clone(),
        recipient_kind: msg.recipient_kind.clone(),
        recipient_token: msg.recipient_token.clone(),
        recipient_name: msg.recipient_name.clone(),
        content: msg.content.clone(),
        sent_at: msg.sent_at.clone(),
    });

    // Espejo al DM frontend (lo que mandó él mismo aparece en su propio chat).
    let _ = app.emit(
        "companion-event",
        DmEvent::Chat {
            chat_id: msg.id.clone(),
            sender_kind: msg.sender_kind.clone(),
            sender_token: msg.sender_token.clone(),
            sender_name: msg.sender_name.clone(),
            recipient_kind: msg.recipient_kind.clone(),
            recipient_token: msg.recipient_token.clone(),
            recipient_name: msg.recipient_name.clone(),
            content: msg.content.clone(),
            sent_at: msg.sent_at.clone(),
        },
    );

    Ok(msg)
}

/// Devuelve los últimos N mensajes de chat de la sesión, en orden cronológico.
#[tauri::command]
pub fn companion_get_chats(
    session_id: String,
    limit: Option<u32>,
    app_state: tauri::State<'_, AppState>,
) -> Result<Vec<ChatMessage>, String> {
    let conn = app_state.db.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(500).min(2000);
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, sender_kind, sender_token, sender_name,
                    recipient_kind, recipient_token, recipient_name,
                    content, sent_at
             FROM companion_chats
             WHERE session_id = ?1
             ORDER BY sent_at DESC
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let mut rows: Vec<ChatMessage> = stmt
        .query_map(rusqlite::params![session_id, limit], |row| {
            Ok(ChatMessage {
                id: row.get(0)?,
                session_id: row.get(1)?,
                sender_kind: row.get(2)?,
                sender_token: row.get(3)?,
                sender_name: row.get(4)?,
                recipient_kind: row.get(5)?,
                recipient_token: row.get(6)?,
                recipient_name: row.get(7)?,
                content: row.get(8)?,
                sent_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Volvemos al orden cronológico ascendente para el render del thread.
    rows.reverse();
    Ok(rows)
}

/// Helper: persiste un ChatMessage a la tabla `companion_chats`. Lo usan
/// `companion_send_chat` (DM → player) y el HTTP handler de `/api/chat/send`
/// (player → cualquiera).
pub fn persist_chat(app_state: &AppState, msg: &ChatMessage) -> Result<(), String> {
    let conn = app_state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO companion_chats
            (id, session_id, sender_kind, sender_token, sender_name,
             recipient_kind, recipient_token, recipient_name,
             content, sent_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            msg.id,
            msg.session_id,
            msg.sender_kind,
            msg.sender_token,
            msg.sender_name,
            msg.recipient_kind,
            msg.recipient_token,
            msg.recipient_name,
            msg.content,
            msg.sent_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

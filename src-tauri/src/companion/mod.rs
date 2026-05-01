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
use tokio::sync::oneshot;

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
#[derive(Debug, Default)]
pub struct PublicState {
    pub campaign_name: String,
    pub pin: Option<String>,
    pub characters: Vec<Character>,
    /// token → conexión. Generado por POST /api/connect.
    pub connections: HashMap<String, ServerConnection>,
    pub started_at: Option<Instant>,
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
    pin: Option<String>,
    campaign_name: Option<String>,
    characters: Option<Vec<Character>>,
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

    tauri::async_runtime::spawn(async move {
        if let Err(e) = server::run(port, public_state, rx).await {
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
    Ok(())
}

#[tauri::command]
pub fn companion_generate_pin() -> String {
    generate_pin()
}

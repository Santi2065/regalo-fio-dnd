//! Player Web Companion — fase B.1 (foundation).
//!
//! Servidor HTTP embebido que expone una URL accesible desde la red WiFi
//! local (ej: `http://192.168.1.42:47823`). Los players pueden conectarse
//! con su celu para ver handouts, su ficha, tirar dados, etc.
//!
//! Esta primera fase entrega:
//! - Lifecycle del server (start / stop / status)
//! - 3 endpoints básicos: GET /, GET /api/session, GET /api/ping
//! - QR code generation para que los players escaneen
//! - PIN opcional (4 dígitos) para auth ligera
//!
//! Lo que NO entra todavía (fases futuras):
//! - Player view real (servida como static SPA)
//! - WebSocket para push de eventos
//! - Connect endpoint con character selection
//! - Handouts privados, dice broadcast, fog sync, etc.

use rand::Rng;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::oneshot;

mod server;

const COMPANION_PORT: u16 = 47823;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CompanionInfo {
    pub url: String,
    pub local_ip: String,
    pub port: u16,
    pub pin: Option<String>,
    pub qr_svg: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CompanionStatus {
    pub running: bool,
    pub info: Option<CompanionInfo>,
    pub connected_players: u32,
}

/// State global del companion. None = apagado.
pub struct CompanionState {
    info: Option<CompanionInfo>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    /// Compartido con el server para que pueda servir info pública vía /api/session.
    pub public_state: Arc<StdMutex<PublicState>>,
}

/// State que el server consume (read-only desde su perspectiva, escrito desde
/// los comandos Tauri). Todo lo que un player puede legítimamente ver.
#[derive(Debug, Default, Clone)]
pub struct PublicState {
    pub campaign_name: String,
    pub pin: Option<String>,
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
    // local-ip-address devuelve la IP del adaptador "main". Si falla
    // (sin red), caemos a localhost — el companion no será visible en
    // celus pero la app no rompe.
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
    state: tauri::State<'_, StdMutex<CompanionState>>,
) -> Result<CompanionInfo, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if guard.info.is_some() {
        return guard
            .info
            .clone()
            .ok_or_else(|| "Already running but info missing".to_string());
    }

    // Validar PIN si fue provisto: solo 4 dígitos.
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
    Ok(())
}

#[tauri::command]
pub fn companion_status(
    state: tauri::State<'_, StdMutex<CompanionState>>,
) -> Result<CompanionStatus, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(CompanionStatus {
        running: guard.info.is_some(),
        info: guard.info.clone(),
        connected_players: 0, // B.2 wires the actual count via WebSocket sessions
    })
}

#[tauri::command]
pub fn companion_generate_pin() -> String {
    generate_pin()
}

//! Axum HTTP server para el companion. Bound a 0.0.0.0 para ser accesible
//! desde la red local (celu de los players).

use axum::{
    extract::State as AxumState,
    http::{header, StatusCode},
    response::{Html, IntoResponse, Json},
    routing::get,
    Router,
};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;
use tower_http::cors::{Any, CorsLayer};

use super::PublicState;

#[derive(Serialize)]
struct SessionInfo {
    campaign_name: String,
    has_pin: bool,
    server_version: &'static str,
}

#[derive(Serialize)]
struct PingResponse {
    ok: bool,
    server: &'static str,
    timestamp: String,
}

const PLACEHOLDER_HTML: &str = r#"<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>DnD Orchestrator · Companion</title>
<style>
  *,*::before,*::after { box-sizing: border-box }
  body {
    margin: 0;
    min-height: 100vh;
    background: linear-gradient(180deg, #18130c 0%, #0e0a06 100%);
    color: #f8f1de;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    max-width: 420px;
    width: 100%;
    text-align: center;
    background: #1a130b;
    border: 1px solid #322818;
    border-radius: 14px;
    padding: 32px 28px;
    box-shadow: 0 10px 40px -10px rgba(212, 167, 84, 0.18);
  }
  .icon { font-size: 48px; margin-bottom: 12px; }
  h1 {
    font-family: "Cinzel", Georgia, serif;
    color: #ecbb47;
    margin: 0 0 8px;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  p {
    color: #b8a274;
    line-height: 1.55;
    margin: 8px 0;
    font-size: 14px;
  }
  .badge {
    display: inline-block;
    margin-top: 16px;
    padding: 4px 10px;
    background: rgba(201, 142, 37, 0.12);
    border: 1px solid rgba(201, 142, 37, 0.4);
    border-radius: 999px;
    color: #ecbb47;
    font-size: 11px;
    font-family: ui-monospace, "JetBrains Mono", monospace;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">⚔</div>
    <h1>DnD Orchestrator</h1>
    <p>Estás conectado al companion server de la sesión.</p>
    <p>La interfaz para jugadores está en construcción —
       en una próxima versión vas a poder elegir tu PJ, recibir
       handouts privados, ver el mapa proyectado y tirar dados.</p>
    <span class="badge">Server activo · v1.3 B.1</span>
  </div>
</body>
</html>"#;

async fn root_handler() -> impl IntoResponse {
    Html(PLACEHOLDER_HTML)
}

async fn session_handler(
    AxumState(state): AxumState<Arc<Mutex<PublicState>>>,
) -> impl IntoResponse {
    let public = state.lock().ok();
    let (campaign_name, has_pin) = match public {
        Some(p) => (p.campaign_name.clone(), p.pin.is_some()),
        None => ("Sesión D&D".to_string(), false),
    };
    Json(SessionInfo {
        campaign_name,
        has_pin,
        server_version: env!("CARGO_PKG_VERSION"),
    })
}

async fn ping_handler() -> impl IntoResponse {
    Json(PingResponse {
        ok: true,
        server: "dnd-orchestrator-companion",
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}

async fn not_found() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        [(header::CONTENT_TYPE, "application/json")],
        r#"{"error":"not_found"}"#,
    )
}

pub async fn run(
    port: u16,
    public_state: Arc<Mutex<PublicState>>,
    shutdown_rx: oneshot::Receiver<()>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // CORS abierto: el companion solo se accede desde LAN, los players
    // pueden tener distintas IPs de origen y el endpoint es read-only por
    // ahora.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/", get(root_handler))
        .route("/api/session", get(session_handler))
        .route("/api/ping", get(ping_handler))
        .fallback(not_found)
        .with_state(public_state)
        .layer(cors);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        })
        .await?;

    Ok(())
}

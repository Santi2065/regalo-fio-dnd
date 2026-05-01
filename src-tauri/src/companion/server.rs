//! Axum HTTP server para el companion. Bound a 0.0.0.0 para ser accesible
//! desde la red local (celu de los players).

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Json as AxumJson, Query, State as AxumState,
    },
    http::{header, HeaderMap, StatusCode},
    response::{Html, IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::oneshot;
use tower_http::cors::{Any, CorsLayer};

use super::{Character, PlayerEvent, PublicState, ServerConnection};

// Embedded mobile-first player view. Servida en GET /. Para B.2 es un
// HTML+JS standalone; en B.3+ podríamos migrar a un build separado de
// Vite/React si crece el scope.
const PLAYER_VIEW_HTML: &str = include_str!("player_view.html");

#[derive(Serialize)]
struct SessionInfo {
    campaign_name: String,
    has_pin: bool,
    server_version: &'static str,
}

#[derive(Serialize)]
struct CharactersResponse {
    characters: Vec<Character>,
}

#[derive(Deserialize)]
struct ConnectRequest {
    character_id: String,
    pin: Option<String>,
}

#[derive(Serialize)]
struct ConnectResponse {
    token: String,
    character: Character,
}

#[derive(Serialize)]
struct MeResponse {
    character: Character,
}

#[derive(Serialize)]
struct PingResponse {
    ok: bool,
    server: &'static str,
    timestamp: String,
}

fn json_error(status: StatusCode, code: &'static str) -> Response {
    (status, Json(json!({ "error": code }))).into_response()
}

fn extract_token(headers: &HeaderMap) -> Option<String> {
    let h = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    h.strip_prefix("Bearer ").map(|s| s.to_string())
}

fn generate_token() -> String {
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| {
            let n = rng.gen_range(0..62);
            let c = match n {
                0..=9 => (b'0' + n as u8) as char,
                10..=35 => (b'a' + (n - 10) as u8) as char,
                _ => (b'A' + (n - 36) as u8) as char,
            };
            c
        })
        .collect()
}

async fn root_handler() -> impl IntoResponse {
    Html(PLAYER_VIEW_HTML)
}

async fn session_handler(
    AxumState(state): AxumState<Arc<Mutex<PublicState>>>,
) -> impl IntoResponse {
    let public = match state.lock() {
        Ok(p) => p,
        Err(_) => return Json(json!({ "error": "lock" })).into_response(),
    };
    Json(SessionInfo {
        campaign_name: public.campaign_name.clone(),
        has_pin: public.pin.is_some(),
        server_version: env!("CARGO_PKG_VERSION"),
    })
    .into_response()
}

async fn characters_handler(
    AxumState(state): AxumState<Arc<Mutex<PublicState>>>,
) -> impl IntoResponse {
    let public = match state.lock() {
        Ok(p) => p,
        Err(_) => return Json(json!({ "error": "lock" })).into_response(),
    };
    Json(CharactersResponse {
        characters: public.characters.clone(),
    })
    .into_response()
}

async fn connect_handler(
    AxumState(state): AxumState<Arc<Mutex<PublicState>>>,
    AxumJson(req): AxumJson<ConnectRequest>,
) -> Response {
    let mut public = match state.lock() {
        Ok(p) => p,
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "lock"),
    };

    // Verificar PIN si la sesión tiene uno.
    if let Some(expected_pin) = &public.pin {
        match req.pin.as_deref() {
            Some(p) if p == expected_pin => {}
            _ => return json_error(StatusCode::UNAUTHORIZED, "pin_invalid"),
        }
    }

    // Verificar que el character existe y no está ya tomado.
    let character = match public
        .characters
        .iter()
        .find(|c| c.id == req.character_id)
        .cloned()
    {
        Some(c) => c,
        None => return json_error(StatusCode::NOT_FOUND, "character_not_found"),
    };

    let already_taken = public
        .connections
        .values()
        .any(|conn| conn.character.id == character.id);
    if already_taken {
        return json_error(StatusCode::CONFLICT, "character_taken");
    }

    let token = generate_token();
    public.connections.insert(
        token.clone(),
        ServerConnection {
            character: character.clone(),
            connected_at: Instant::now(),
        },
    );

    Json(ConnectResponse { token, character }).into_response()
}

async fn me_handler(
    AxumState(state): AxumState<Arc<Mutex<PublicState>>>,
    headers: HeaderMap,
) -> Response {
    let token = match extract_token(&headers) {
        Some(t) => t,
        None => return json_error(StatusCode::UNAUTHORIZED, "missing_token"),
    };
    let public = match state.lock() {
        Ok(p) => p,
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "lock"),
    };
    match public.connections.get(&token) {
        Some(conn) => Json(MeResponse {
            character: conn.character.clone(),
        })
        .into_response(),
        None => json_error(StatusCode::UNAUTHORIZED, "invalid_token"),
    }
}

async fn disconnect_handler(
    AxumState(state): AxumState<Arc<Mutex<PublicState>>>,
    headers: HeaderMap,
) -> Response {
    let token = match extract_token(&headers) {
        Some(t) => t,
        None => return json_error(StatusCode::UNAUTHORIZED, "missing_token"),
    };
    let mut public = match state.lock() {
        Ok(p) => p,
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "lock"),
    };
    public.connections.remove(&token);
    Json(json!({ "ok": true })).into_response()
}

#[derive(Deserialize)]
struct WsQuery {
    token: String,
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    AxumState(state): AxumState<Arc<Mutex<PublicState>>>,
) -> Response {
    // Validar token contra connections antes de upgrade.
    let valid = match state.lock() {
        Ok(p) => p.connections.contains_key(&q.token),
        Err(_) => false,
    };
    if !valid {
        return (StatusCode::UNAUTHORIZED, "invalid_token").into_response();
    }
    let token = q.token.clone();
    let state_clone = state.clone();
    ws.on_upgrade(move |socket| handle_socket(socket, token, state_clone))
}

async fn handle_socket(mut socket: WebSocket, token: String, state: Arc<Mutex<PublicState>>) {
    // Subscribe al broadcast de eventos.
    let mut rx = match state.lock() {
        Ok(p) => p.events.subscribe(),
        Err(_) => return,
    };

    // Send initial hello para que el player sepa que está conectado.
    let _ = socket
        .send(Message::Text(
            serde_json::to_string(&serde_json::json!({
                "type": "hello",
                "ts": chrono::Utc::now().to_rfc3339(),
            }))
            .unwrap_or_default(),
        ))
        .await;

    loop {
        tokio::select! {
            // Eventos del DM al player.
            evt = rx.recv() => {
                let Ok(evt) = evt else { break };
                let should_deliver = match &evt {
                    PlayerEvent::Handout { to_token, .. } => {
                        match to_token {
                            None => true, // broadcast
                            Some(t) => t == &token,
                        }
                    }
                    PlayerEvent::Kicked { to_token } => to_token == &token,
                };
                if !should_deliver {
                    continue;
                }
                let payload = match serde_json::to_string(&evt) {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                if socket.send(Message::Text(payload)).await.is_err() {
                    break;
                }
                if matches!(evt, PlayerEvent::Kicked { .. }) {
                    break;
                }
            }
            // Mensajes del cliente — por ahora ignoramos (B.3.b va a recibir
            // dice rolls, etc).
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }
}

async fn ping_handler() -> impl IntoResponse {
    Json(PingResponse {
        ok: true,
        server: "dnd-orchestrator-companion",
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}

async fn not_found() -> impl IntoResponse {
    json_error(StatusCode::NOT_FOUND, "not_found")
}

pub async fn run(
    port: u16,
    public_state: Arc<Mutex<PublicState>>,
    shutdown_rx: oneshot::Receiver<()>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/", get(root_handler))
        .route("/api/session", get(session_handler))
        .route("/api/characters", get(characters_handler))
        .route("/api/connect", post(connect_handler))
        .route("/api/me", get(me_handler))
        .route("/api/disconnect", post(disconnect_handler))
        .route("/api/ping", get(ping_handler))
        .route("/ws", get(ws_handler))
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

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
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;
use tower_http::cors::{Any, CorsLayer};

use super::{
    Character, ChatMessage, DmEvent, PlayerEvent, PublicState, ServerConnection,
};

/// State compartido entre todos los handlers de axum. Empaqueta el state
/// público (mutado desde Tauri commands) y el AppHandle (para emitir
/// eventos al frontend del DM).
#[derive(Clone)]
struct AppCtx {
    public: Arc<Mutex<PublicState>>,
    app: AppHandle,
}

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
    AxumState(ctx): AxumState<AppCtx>,
) -> impl IntoResponse {
    let public = match ctx.public.lock() {
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
    AxumState(ctx): AxumState<AppCtx>,
) -> impl IntoResponse {
    let public = match ctx.public.lock() {
        Ok(p) => p,
        Err(_) => return Json(json!({ "error": "lock" })).into_response(),
    };
    Json(CharactersResponse {
        characters: public.characters.clone(),
    })
    .into_response()
}

async fn connect_handler(
    AxumState(ctx): AxumState<AppCtx>,
    AxumJson(req): AxumJson<ConnectRequest>,
) -> Response {
    let mut public = match ctx.public.lock() {
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
    AxumState(ctx): AxumState<AppCtx>,
    headers: HeaderMap,
) -> Response {
    let token = match extract_token(&headers) {
        Some(t) => t,
        None => return json_error(StatusCode::UNAUTHORIZED, "missing_token"),
    };
    let public = match ctx.public.lock() {
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
    AxumState(ctx): AxumState<AppCtx>,
    headers: HeaderMap,
) -> Response {
    let token = match extract_token(&headers) {
        Some(t) => t,
        None => return json_error(StatusCode::UNAUTHORIZED, "missing_token"),
    };
    let mut public = match ctx.public.lock() {
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
    AxumState(ctx): AxumState<AppCtx>,
) -> Response {
    // Validar token contra connections antes de upgrade.
    let valid = match ctx.public.lock() {
        Ok(p) => p.connections.contains_key(&q.token),
        Err(_) => false,
    };
    if !valid {
        return (StatusCode::UNAUTHORIZED, "invalid_token").into_response();
    }
    let token = q.token.clone();
    let public_clone = ctx.public.clone();
    ws.on_upgrade(move |socket| handle_socket(socket, token, public_clone))
}

async fn handle_socket(mut socket: WebSocket, token: String, public: Arc<Mutex<PublicState>>) {
    // Subscribe al broadcast de eventos.
    let mut rx = match public.lock() {
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
                    PlayerEvent::Chat { recipient_token, sender_token, .. } => {
                        // Solo entregamos al destinatario. NO al sender (ya
                        // recibió ack via HTTP), NO al DM (recibe espejo via
                        // DmEvent::Chat). Si el chat es al DM
                        // (recipient_token == None), ningún celu lo recibe.
                        match recipient_token {
                            None => false,
                            Some(rt) => rt == &token && sender_token.as_ref() != Some(&token),
                        }
                    }
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

// ── Dice roll desde el celu del player ──────────────────────────────────────

#[derive(Deserialize)]
struct RollRequest {
    expression: String,
}

#[derive(Serialize)]
struct RollResponse {
    total: i64,
    breakdown: String,
    expression: String,
}

/// Mini parser de dados — versión Rust de lo mismo que tiene el frontend
/// del DM en src/lib/dice.ts. Soporta XdY, +/- mod, advantage/disadvantage,
/// kh/kl. Para el player es la única forma de tirar dados (no descargamos
/// JS completo en el celu para esto).
fn roll_dice(expr: &str) -> Result<(i64, String), String> {
    let trimmed = expr.trim().to_lowercase();
    if trimmed.is_empty() {
        return Err("expresión vacía".into());
    }

    // Detectar adv/dis
    let (body, adv) = if let Some(idx) = trimmed.find(" adv") {
        (trimmed[..idx].trim().to_string(), Some("adv"))
    } else if let Some(idx) = trimmed.find(" dis") {
        (trimmed[..idx].trim().to_string(), Some("dis"))
    } else {
        (trimmed.clone(), None)
    };

    let mut rng = rand::thread_rng();
    let mut total: i64 = 0;
    let mut parts: Vec<String> = Vec::new();
    let mut handled_adv = false;

    // Parse dice tokens: ej "2d6", "1d20+5", "4d6kh3"
    let dice_re = regex_lite_dice(&body);
    if dice_re.is_empty() {
        return Err("no encontré dados (ej: 1d20+5)".into());
    }
    for (count, sides, keep) in &dice_re {
        if *count > 100 {
            return Err("máx 100 dados por grupo".into());
        }
        let is_first = parts.is_empty();
        let apply_adv = adv.is_some() && is_first && *sides == 20 && keep.is_none();
        let mut values: Vec<i64> = Vec::new();
        if apply_adv {
            handled_adv = true;
            let a = rng.gen_range(1..=20);
            let b = rng.gen_range(1..=20);
            values = vec![a, b];
            let kept = if adv == Some("adv") {
                a.max(b)
            } else {
                a.min(b)
            };
            total += kept;
            parts.push(format!("[{}, {}]", a, b));
        } else {
            for _ in 0..*count {
                values.push(rng.gen_range(1..=*sides as i64));
            }
            let kept_values = match keep {
                Some(("h", n)) => {
                    let mut sorted = values.clone();
                    sorted.sort();
                    sorted.into_iter().rev().take(*n).collect::<Vec<_>>()
                }
                Some(("l", n)) => {
                    let mut sorted = values.clone();
                    sorted.sort();
                    sorted.into_iter().take(*n).collect::<Vec<_>>()
                }
                _ => values.clone(),
            };
            let sum: i64 = kept_values.iter().sum();
            total += sum;
            if values.len() == 1 {
                parts.push(format!("{}", values[0]));
            } else {
                parts.push(format!(
                    "[{}]",
                    values
                        .iter()
                        .map(|v| v.to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
        }
    }

    // Parse modifiers (+N, -N) que NO están dentro de un token de dados
    let mod_re = regex_lite_modifier(&body);
    let mut modifier: i64 = 0;
    for (sign, n) in &mod_re {
        modifier += if *sign == '-' { -*n } else { *n };
    }
    total += modifier;

    let mod_str = if modifier != 0 {
        format!(" {}{}", if modifier > 0 { "+" } else { "" }, modifier)
    } else {
        String::new()
    };
    let adv_str = if handled_adv {
        format!(" ({})", adv.unwrap_or(""))
    } else {
        String::new()
    };
    let breakdown = format!("{}{}{} = {}", parts.join(" + "), mod_str, adv_str, total);

    Ok((total, breakdown))
}

/// Devuelve grupos (count, sides, Option<(direction, keep_n)>)
fn regex_lite_dice(s: &str) -> Vec<(usize, u32, Option<(&str, usize)>)> {
    let mut out = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // Find 'd' that's preceded by digit or start.
        if bytes[i] != b'd' {
            i += 1;
            continue;
        }
        // Walk back to count.
        let mut count_start = i;
        while count_start > 0 && bytes[count_start - 1].is_ascii_digit() {
            count_start -= 1;
        }
        let count: usize = if count_start == i {
            1
        } else {
            std::str::from_utf8(&bytes[count_start..i])
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(1)
        };
        // Walk forward to sides.
        let mut sides_end = i + 1;
        while sides_end < bytes.len() && bytes[sides_end].is_ascii_digit() {
            sides_end += 1;
        }
        if sides_end == i + 1 {
            i += 1;
            continue;
        }
        let sides: u32 = std::str::from_utf8(&bytes[i + 1..sides_end])
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        // Optional keep.
        let mut keep: Option<(&str, usize)> = None;
        if sides_end < bytes.len() && bytes[sides_end] == b'k' {
            if sides_end + 1 < bytes.len() {
                let dir = match bytes[sides_end + 1] {
                    b'h' => Some("h"),
                    b'l' => Some("l"),
                    _ => None,
                };
                if let Some(d) = dir {
                    let mut n_end = sides_end + 2;
                    while n_end < bytes.len() && bytes[n_end].is_ascii_digit() {
                        n_end += 1;
                    }
                    if n_end > sides_end + 2 {
                        let n: usize = std::str::from_utf8(&bytes[sides_end + 2..n_end])
                            .ok()
                            .and_then(|s| s.parse().ok())
                            .unwrap_or(0);
                        if n > 0 {
                            keep = Some((d, n));
                            i = n_end;
                            out.push((count, sides, keep));
                            continue;
                        }
                    }
                }
            }
        }
        if sides > 0 {
            out.push((count, sides, keep));
        }
        i = sides_end;
    }
    out
}

/// Devuelve modifiers (+N o -N) que NO están adyacentes a un token de dados.
/// Estrategia: extraer todos los `+\d+` / `-\d+`, restar los que aparecen en
/// posiciones donde el char previo es 'd' o un dígito (forma parte de XdY+M
/// pero el +M ya quedó como modifier, así que esto no es correcto. Voy a
/// simplificar: tras strippear los tokens dXX, los modifiers que queden son
/// los reales.)
fn regex_lite_modifier(s: &str) -> Vec<(char, i64)> {
    // Strip los tokens de dados. Reemplazamos cada NdM[khN] con un espacio.
    let mut clean = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if c == b'd'
            && i > 0
            && bytes[i - 1].is_ascii_digit()
            && i + 1 < bytes.len()
            && bytes[i + 1].is_ascii_digit()
        {
            // walk back over digits we already wrote
            while clean.ends_with(|c: char| c.is_ascii_digit()) {
                clean.pop();
            }
            // skip "dM"
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            // skip optional khN / klN
            if i < bytes.len() && bytes[i] == b'k' && i + 1 < bytes.len() {
                let dir = bytes[i + 1];
                if dir == b'h' || dir == b'l' {
                    i += 2;
                    while i < bytes.len() && bytes[i].is_ascii_digit() {
                        i += 1;
                    }
                }
            }
            continue;
        }
        clean.push(c as char);
        i += 1;
    }

    let mut out = Vec::new();
    let cb = clean.as_bytes();
    let mut j = 0;
    while j < cb.len() {
        if cb[j] == b'+' || cb[j] == b'-' {
            let sign = cb[j] as char;
            let mut k = j + 1;
            while k < cb.len() && cb[k] == b' ' {
                k += 1;
            }
            let mut n_end = k;
            while n_end < cb.len() && cb[n_end].is_ascii_digit() {
                n_end += 1;
            }
            if n_end > k {
                if let Ok(n) = std::str::from_utf8(&cb[k..n_end])
                    .unwrap_or("0")
                    .parse::<i64>()
                {
                    out.push((sign, n));
                }
                j = n_end;
                continue;
            }
        }
        j += 1;
    }
    out
}

async fn roll_handler(
    AxumState(ctx): AxumState<AppCtx>,
    headers: HeaderMap,
    AxumJson(req): AxumJson<RollRequest>,
) -> Response {
    let token = match extract_token(&headers) {
        Some(t) => t,
        None => return json_error(StatusCode::UNAUTHORIZED, "missing_token"),
    };
    let from_name = match ctx.public.lock() {
        Ok(p) => p
            .connections
            .get(&token)
            .map(|c| c.character.name.clone()),
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "lock"),
    };
    let from_name = match from_name {
        Some(n) => n,
        None => return json_error(StatusCode::UNAUTHORIZED, "invalid_token"),
    };

    let (total, breakdown) = match roll_dice(&req.expression) {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "bad_expression", "detail": e })),
            )
                .into_response();
        }
    };

    // Empuja al frontend del DM via Tauri event.
    let _ = ctx.app.emit(
        "companion-event",
        DmEvent::DiceRoll {
            from_token: token,
            from_name,
            expression: req.expression.clone(),
            total,
            breakdown: breakdown.clone(),
        },
    );

    Json(RollResponse {
        total,
        breakdown,
        expression: req.expression,
    })
    .into_response()
}

async fn ping_handler() -> impl IntoResponse {
    Json(PingResponse {
        ok: true,
        server: "dnd-orchestrator-companion",
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}

#[derive(Serialize)]
struct ChatPartner {
    kind: &'static str,        // "dm" | "player"
    id: String,                // "dm" o el token del player
    name: String,
}

async fn chat_partners_handler(
    AxumState(ctx): AxumState<AppCtx>,
    headers: HeaderMap,
) -> Response {
    let token = match extract_token(&headers) {
        Some(t) => t,
        None => return json_error(StatusCode::UNAUTHORIZED, "missing_token"),
    };
    let public = match ctx.public.lock() {
        Ok(p) => p,
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "lock"),
    };
    if !public.connections.contains_key(&token) {
        return json_error(StatusCode::UNAUTHORIZED, "invalid_token");
    }
    let mut partners: Vec<ChatPartner> = vec![ChatPartner {
        kind: "dm",
        id: "dm".to_string(),
        name: "DM".to_string(),
    }];
    for (other_token, conn) in public.connections.iter() {
        if other_token == &token {
            continue;
        }
        partners.push(ChatPartner {
            kind: "player",
            id: other_token.clone(),
            name: conn.character.name.clone(),
        });
    }
    Json(partners).into_response()
}

// ── Chat desde el celu del player ───────────────────────────────────────────
//
// El player manda mensajes a "dm" (privado al DM) o a otro player token
// (whisper que el otro player ve "privado", pero el DM también lo ve via
// DmEvent::Chat — los players no lo saben, ese es el feature key).

#[derive(Deserialize)]
struct ChatRequest {
    recipient_token: String, // "dm" o token de otro player
    content: String,
}

#[derive(Serialize)]
struct ChatResponse {
    chat_id: String,
    sent_at: String,
}

async fn chat_handler(
    AxumState(ctx): AxumState<AppCtx>,
    headers: HeaderMap,
    AxumJson(req): AxumJson<ChatRequest>,
) -> Response {
    let token = match extract_token(&headers) {
        Some(t) => t,
        None => return json_error(StatusCode::UNAUTHORIZED, "missing_token"),
    };

    let trimmed = req.content.trim();
    if trimmed.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "empty_content");
    }
    if trimmed.len() > 2000 {
        return json_error(StatusCode::BAD_REQUEST, "content_too_long");
    }

    // Validar sender + resolver recipient.
    let (session_id, sender_name, recipient_kind, recipient_token, recipient_name) = {
        let public = match ctx.public.lock() {
            Ok(p) => p,
            Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "lock"),
        };
        let session_id = match public.session_id.clone() {
            Some(s) => s,
            None => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "no_session"),
        };
        let sender_name = match public.connections.get(&token) {
            Some(c) => c.character.name.clone(),
            None => return json_error(StatusCode::UNAUTHORIZED, "invalid_token"),
        };

        if req.recipient_token == "dm" {
            (session_id, sender_name, "dm".to_string(), None, "DM".to_string())
        } else {
            match public.connections.get(&req.recipient_token) {
                Some(c) => (
                    session_id,
                    sender_name,
                    "player".to_string(),
                    Some(req.recipient_token.clone()),
                    c.character.name.clone(),
                ),
                None => return json_error(StatusCode::BAD_REQUEST, "recipient_not_connected"),
            }
        }
    };

    let msg = ChatMessage {
        id: uuid::Uuid::new_v4().to_string(),
        session_id,
        sender_kind: "player".to_string(),
        sender_token: Some(token.clone()),
        sender_name: sender_name.clone(),
        recipient_kind: recipient_kind.clone(),
        recipient_token: recipient_token.clone(),
        recipient_name: recipient_name.clone(),
        content: trimmed.to_string(),
        sent_at: chrono::Utc::now().to_rfc3339(),
    };

    // Persist a DB. Accedemos al AppState via el AppHandle (cleaner que
    // pasarlo en AppCtx — el server no necesita el AppState para nada más).
    // El método `state` viene del trait `Manager` y devuelve State<T>
    // directamente (panic si no está registrado, lo cual no debería pasar
    // porque AppState se registra al boot de la app).
    let app_state = ctx.app.state::<crate::AppState>();
    if let Err(e) = super::persist_chat(&app_state, &msg) {
        eprintln!("[companion] persist chat failed: {e}");
    }

    // Push WS al destinatario (el handler filtra con recipient_token).
    if let Ok(public) = ctx.public.lock() {
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
    }

    // Espejo al DM: el DM SIEMPRE recibe todos los mensajes, sin importar
    // si el chat aparenta ser entre players. Ese es el "espionaje" que el
    // user pidió explícitamente.
    let _ = ctx.app.emit(
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

    Json(ChatResponse {
        chat_id: msg.id,
        sent_at: msg.sent_at,
    })
    .into_response()
}

async fn not_found() -> impl IntoResponse {
    json_error(StatusCode::NOT_FOUND, "not_found")
}

pub async fn run(
    port: u16,
    public_state: Arc<Mutex<PublicState>>,
    app: AppHandle,
    shutdown_rx: oneshot::Receiver<()>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let ctx = AppCtx {
        public: public_state,
        app,
    };

    let router: Router = Router::new()
        .route("/", get(root_handler))
        .route("/api/session", get(session_handler))
        .route("/api/characters", get(characters_handler))
        .route("/api/connect", post(connect_handler))
        .route("/api/me", get(me_handler))
        .route("/api/disconnect", post(disconnect_handler))
        .route("/api/roll", post(roll_handler))
        .route("/api/chat/send", post(chat_handler))
        .route("/api/chat/partners", get(chat_partners_handler))
        .route("/api/ping", get(ping_handler))
        .route("/ws", get(ws_handler))
        .fallback(not_found)
        .with_state(ctx)
        .layer(cors);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, router)
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        })
        .await?;

    Ok(())
}

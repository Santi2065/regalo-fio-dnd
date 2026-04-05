use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use once_cell::sync::OnceCell;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    sync::Mutex,
};

// ── Constants ─────────────────────────────────────────────────────────────────

const REDIRECT_URI: &str = "http://127.0.0.1:8888/callback";
const SCOPES: &str = "user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative";
const TOKEN_FILE: &str = "spotify_tokens.json";

// ── State ──────────────────────────────────────────────────────────────────────

static PKCE_VERIFIER: OnceCell<Mutex<Option<String>>> = OnceCell::new();

fn pkce_store() -> &'static Mutex<Option<String>> {
    PKCE_VERIFIER.get_or_init(|| Mutex::new(None))
}

// ── Token storage ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpotifyTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64, // unix seconds
}

impl SpotifyTokens {
    fn is_expired(&self) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        now >= self.expires_at.saturating_sub(60) // refresh 60s early
    }
}

fn token_path() -> std::path::PathBuf {
    crate::db::get_app_data_dir().join(TOKEN_FILE)
}

fn load_tokens() -> Option<SpotifyTokens> {
    let data = std::fs::read_to_string(token_path()).ok()?;
    serde_json::from_str(&data).ok()
}

fn save_tokens(tokens: &SpotifyTokens) {
    if let Ok(data) = serde_json::to_string_pretty(tokens) {
        std::fs::write(token_path(), data).ok();
    }
}

fn delete_tokens() {
    std::fs::remove_file(token_path()).ok();
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────

fn generate_code_verifier() -> String {
    let mut bytes = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn code_challenge(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hash)
}

// ── OAuth flow ─────────────────────────────────────────────────────────────────

/// Build the Spotify authorization URL and store the code verifier.
#[tauri::command]
pub fn spotify_auth_url(client_id: String) -> Result<String, String> {
    let verifier = generate_code_verifier();
    let challenge = code_challenge(&verifier);

    *pkce_store().lock().map_err(|e| e.to_string())? = Some(verifier);

    let state = URL_SAFE_NO_PAD.encode(&rand::random::<[u8; 16]>());

    let url = format!(
        "https://accounts.spotify.com/authorize\
         ?client_id={client_id}\
         &response_type=code\
         &redirect_uri={}\
         &code_challenge_method=S256\
         &code_challenge={challenge}\
         &state={state}\
         &scope={}",
        urlencoding::encode(REDIRECT_URI),
        urlencoding::encode(SCOPES),
    );

    Ok(url)
}

/// Start a temporary local HTTP server to capture the OAuth callback.
/// Returns the access/refresh tokens on success.
#[tauri::command]
pub async fn spotify_exchange_code(client_id: String) -> Result<SpotifyTokens, String> {
    let verifier = pkce_store()
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("No PKCE verifier found — call spotify_auth_url first")?;

    // Listen for the callback
    let listener =
        TcpListener::bind("127.0.0.1:8888").map_err(|e| format!("Port 8888 in use: {e}"))?;

    let (mut stream, _) = listener
        .accept()
        .map_err(|e: std::io::Error| format!("Callback error: {e}"))?;

    // Read HTTP request line
    let mut reader = BufReader::new(&stream);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|e| e.to_string())?;

    // Parse code from "GET /callback?code=XXX&state=YYY HTTP/1.1"
    let path = request_line
        .split_whitespace()
        .nth(1)
        .unwrap_or("/");

    let code = url::Url::parse(&format!("http://localhost{path}"))
        .ok()
        .and_then(|u| {
            u.query_pairs()
                .find(|(k, _)| k == "code")
                .map(|(_, v)| v.to_string())
        })
        .ok_or("No code in callback URL")?;

    // Send success page to browser
    let html = "<html><body style='font-family:sans-serif;background:#1a1a1a;color:#eee;padding:40px'>
        <h2>✅ ¡Conectado a Spotify!</h2>
        <p>Podés cerrar esta pestaña y volver a la app.</p></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    stream.write_all(response.as_bytes()).ok();
    drop(stream);
    drop(listener);

    // Exchange code for tokens
    exchange_code_for_tokens(&client_id, &code, &verifier).await
}

async fn exchange_code_for_tokens(
    client_id: &str,
    code: &str,
    verifier: &str,
) -> Result<SpotifyTokens, String> {
    let client = reqwest::Client::new();
    let params = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", REDIRECT_URI),
        ("client_id", client_id),
        ("code_verifier", verifier),
    ];

    let resp = client
        .post("https://accounts.spotify.com/api/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Token exchange failed: {text}"));
    }

    #[derive(Deserialize)]
    struct TokenResp {
        access_token: String,
        refresh_token: String,
        expires_in: u64,
    }

    let data: TokenResp = resp.json().await.map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let tokens = SpotifyTokens {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: now + data.expires_in,
    };
    save_tokens(&tokens);
    Ok(tokens)
}

async fn refresh_access_token(
    client_id: &str,
    refresh_token: &str,
) -> Result<SpotifyTokens, String> {
    let client = reqwest::Client::new();
    let params = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", client_id),
    ];

    let resp = client
        .post("https://accounts.spotify.com/api/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Refresh failed: {text}"));
    }

    #[derive(Deserialize)]
    struct TokenResp {
        access_token: String,
        refresh_token: Option<String>,
        expires_in: u64,
    }

    let data: TokenResp = resp.json().await.map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let old = load_tokens().ok_or("No tokens")?;
    let tokens = SpotifyTokens {
        access_token: data.access_token,
        refresh_token: data.refresh_token.unwrap_or(old.refresh_token),
        expires_at: now + data.expires_in,
    };
    save_tokens(&tokens);
    Ok(tokens)
}

/// Get a valid access token, refreshing if needed.
async fn get_valid_token(client_id: &str) -> Result<String, String> {
    let mut tokens = load_tokens().ok_or("Not authenticated")?;
    if tokens.is_expired() {
        tokens = refresh_access_token(client_id, &tokens.refresh_token.clone()).await?;
    }
    Ok(tokens.access_token)
}

// ── Spotify API commands ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct SpotifyStatus {
    pub authenticated: bool,
}

#[tauri::command]
pub fn spotify_status() -> SpotifyStatus {
    SpotifyStatus {
        authenticated: load_tokens().is_some(),
    }
}

#[tauri::command]
pub fn spotify_logout() {
    delete_tokens();
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SpotifyTrack {
    pub id: String,
    pub name: String,
    pub artist: String,
    pub album: String,
    pub album_art: Option<String>,
    pub duration_ms: u64,
    pub progress_ms: u64,
    pub is_playing: bool,
}

#[tauri::command]
pub async fn spotify_current_track(client_id: String) -> Result<Option<SpotifyTrack>, String> {
    let token = get_valid_token(&client_id).await?;

    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.spotify.com/v1/me/player/currently-playing")
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status() == 204 {
        return Ok(None); // Nothing playing
    }
    if !resp.status().is_success() {
        return Err(format!("API error: {}", resp.status()));
    }

    #[derive(Deserialize)]
    struct Image { url: String }
    #[derive(Deserialize)]
    struct Album { name: String, images: Vec<Image> }
    #[derive(Deserialize)]
    struct Artist { name: String }
    #[derive(Deserialize)]
    struct Item {
        id: String,
        name: String,
        artists: Vec<Artist>,
        album: Album,
        duration_ms: u64,
    }
    #[derive(Deserialize)]
    struct Response {
        item: Option<Item>,
        progress_ms: Option<u64>,
        is_playing: bool,
    }

    let data: Response = resp.json().await.map_err(|e| e.to_string())?;
    let item = match data.item {
        Some(i) => i,
        None => return Ok(None),
    };

    Ok(Some(SpotifyTrack {
        id: item.id,
        name: item.name,
        artist: item.artists.into_iter().map(|a| a.name).collect::<Vec<_>>().join(", "),
        album: item.album.name,
        album_art: item.album.images.first().map(|i| i.url.clone()),
        duration_ms: item.duration_ms,
        progress_ms: data.progress_ms.unwrap_or(0),
        is_playing: data.is_playing,
    }))
}

#[tauri::command]
pub async fn spotify_play_pause(client_id: String) -> Result<(), String> {
    let token = get_valid_token(&client_id).await?;
    let client = reqwest::Client::new();

    // Get current state to decide play vs pause
    let state_resp = client
        .get("https://api.spotify.com/v1/me/player")
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    #[derive(Deserialize)]
    struct State { is_playing: bool }

    let is_playing = if state_resp.status() == 204 {
        false
    } else {
        state_resp.json::<State>().await.map(|s| s.is_playing).unwrap_or(false)
    };

    let endpoint = if is_playing {
        "https://api.spotify.com/v1/me/player/pause"
    } else {
        "https://api.spotify.com/v1/me/player/play"
    };

    client
        .put(endpoint)
        .bearer_auth(&token)
        .header("Content-Length", "0")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn spotify_next(client_id: String) -> Result<(), String> {
    let token = get_valid_token(&client_id).await?;
    reqwest::Client::new()
        .post("https://api.spotify.com/v1/me/player/next")
        .bearer_auth(&token)
        .header("Content-Length", "0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn spotify_previous(client_id: String) -> Result<(), String> {
    let token = get_valid_token(&client_id).await?;
    reqwest::Client::new()
        .post("https://api.spotify.com/v1/me/player/previous")
        .bearer_auth(&token)
        .header("Content-Length", "0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn spotify_set_volume(client_id: String, volume_percent: u8) -> Result<(), String> {
    let token = get_valid_token(&client_id).await?;
    reqwest::Client::new()
        .put(format!(
            "https://api.spotify.com/v1/me/player/volume?volume_percent={volume_percent}"
        ))
        .bearer_auth(&token)
        .header("Content-Length", "0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SpotifyPlaylist {
    pub id: String,
    pub name: String,
    pub image: Option<String>,
    pub track_count: u32,
}

#[tauri::command]
pub async fn spotify_get_playlists(client_id: String) -> Result<Vec<SpotifyPlaylist>, String> {
    let token = get_valid_token(&client_id).await?;

    #[derive(Deserialize)]
    struct Image { url: String }
    #[derive(Deserialize)]
    struct Tracks { total: u32 }
    #[derive(Deserialize)]
    struct Item { id: String, name: String, images: Vec<Image>, tracks: Tracks }
    #[derive(Deserialize)]
    struct Response { items: Vec<Item> }

    let resp = reqwest::Client::new()
        .get("https://api.spotify.com/v1/me/playlists?limit=50")
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("API error: {}", resp.status()));
    }

    let data: Response = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data.items.into_iter().map(|i| SpotifyPlaylist {
        id: i.id,
        name: i.name,
        image: i.images.first().map(|img| img.url.clone()),
        track_count: i.tracks.total,
    }).collect())
}

#[tauri::command]
pub async fn spotify_play_playlist(client_id: String, playlist_id: String) -> Result<(), String> {
    let token = get_valid_token(&client_id).await?;
    let body = serde_json::json!({ "context_uri": format!("spotify:playlist:{playlist_id}") });
    reqwest::Client::new()
        .put("https://api.spotify.com/v1/me/player/play")
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SpotifyTrackItem {
    pub id: String,
    pub uri: String,
    pub name: String,
    pub artist: String,
    pub duration_ms: u64,
    pub track_number: u32,
}

#[tauri::command]
pub async fn spotify_get_playlist_tracks(
    client_id: String,
    playlist_id: String,
) -> Result<Vec<SpotifyTrackItem>, String> {
    let token = get_valid_token(&client_id).await?;

    #[derive(Deserialize)]
    struct Artist { name: String }
    #[derive(Deserialize)]
    struct Track {
        id: Option<String>,
        uri: String,
        name: String,
        artists: Vec<Artist>,
        duration_ms: u64,
        track_number: u32,
    }
    #[derive(Deserialize)]
    struct Item { track: Option<Track> }
    #[derive(Deserialize)]
    struct Response { items: Vec<Item>, next: Option<String> }

    let mut all: Vec<SpotifyTrackItem> = Vec::new();
    let mut url = format!(
        "https://api.spotify.com/v1/playlists/{playlist_id}/tracks?limit=100&fields=items(track(id,uri,name,artists,duration_ms,track_number)),next"
    );

    loop {
        let resp = reqwest::Client::new()
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("API error: {}", resp.status()));
        }

        let data: Response = resp.json().await.map_err(|e| e.to_string())?;

        for item in data.items {
            if let Some(t) = item.track {
                if let Some(id) = t.id {
                    all.push(SpotifyTrackItem {
                        id,
                        uri: t.uri,
                        name: t.name,
                        artist: t.artists.into_iter().map(|a| a.name).collect::<Vec<_>>().join(", "),
                        duration_ms: t.duration_ms,
                        track_number: t.track_number,
                    });
                }
            }
        }

        match data.next {
            Some(next_url) if all.len() < 500 => url = next_url,
            _ => break,
        }
    }

    Ok(all)
}

/// Play a specific track within a playlist context (so playback continues naturally).
#[tauri::command]
pub async fn spotify_play_track(
    client_id: String,
    playlist_id: String,
    track_uri: String,
) -> Result<(), String> {
    let token = get_valid_token(&client_id).await?;
    let body = serde_json::json!({
        "context_uri": format!("spotify:playlist:{playlist_id}"),
        "offset": { "uri": track_uri }
    });
    reqwest::Client::new()
        .put("https://api.spotify.com/v1/me/player/play")
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

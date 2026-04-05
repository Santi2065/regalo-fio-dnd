import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string;

interface Track {
  id: string;
  name: string;
  artist: string;
  album: string;
  album_art: string | null;
  duration_ms: number;
  progress_ms: number;
  is_playing: boolean;
}

interface Playlist {
  id: string;
  name: string;
  image: string | null;
  track_count: number;
}

type View = "player" | "playlists";

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function SpotifyPanel() {
  const [authenticated, setAuthenticated] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [track, setTrack] = useState<Track | null>(null);
  const [volume, setVolume] = useState(50);
  const [view, setView] = useState<View>("player");
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkAuth = useCallback(async () => {
    const status = await invoke<{ authenticated: boolean }>("spotify_status");
    setAuthenticated(status.authenticated);
    return status.authenticated;
  }, []);

  // Poll current track
  const pollTrack = useCallback(async () => {
    if (!authenticated) return;
    try {
      const t = await invoke<Track | null>("spotify_current_track", { clientId: CLIENT_ID });
      setTrack(t);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [authenticated]);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (!authenticated) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollTrack();
    pollRef.current = setInterval(pollTrack, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [authenticated, pollTrack]);

  const handleLogin = async () => {
    setConnecting(true);
    setError(null);
    try {
      const url = await invoke<string>("spotify_auth_url", { clientId: CLIENT_ID });
      // Open browser for auth
      await openUrl(url);
      // Wait for the OAuth callback (Rust TCP server blocks until it gets it)
      await invoke<unknown>("spotify_exchange_code", { clientId: CLIENT_ID });
      setAuthenticated(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setConnecting(false);
    }
  };

  const handleLogout = async () => {
    await invoke("spotify_logout");
    setAuthenticated(false);
    setTrack(null);
  };

  const handlePlayPause = async () => {
    try {
      await invoke("spotify_play_pause", { clientId: CLIENT_ID });
      setTimeout(pollTrack, 300);
    } catch (e) { setError(String(e)); }
  };

  const handleNext = async () => {
    try {
      await invoke("spotify_next", { clientId: CLIENT_ID });
      setTimeout(pollTrack, 800);
    } catch (e) { setError(String(e)); }
  };

  const handlePrev = async () => {
    try {
      await invoke("spotify_previous", { clientId: CLIENT_ID });
      setTimeout(pollTrack, 800);
    } catch (e) { setError(String(e)); }
  };

  const handleVolume = async (v: number) => {
    setVolume(v);
    try {
      await invoke("spotify_set_volume", { clientId: CLIENT_ID, volumePercent: v });
    } catch (e) { setError(String(e)); }
  };

  const loadPlaylists = async () => {
    setLoadingPlaylists(true);
    try {
      const pls = await invoke<Playlist[]>("spotify_get_playlists", { clientId: CLIENT_ID });
      setPlaylists(pls);
    } catch (e) { setError(String(e)); }
    finally { setLoadingPlaylists(false); }
  };

  const playPlaylist = async (id: string) => {
    try {
      await invoke("spotify_play_playlist", { clientId: CLIENT_ID, playlistId: id });
      setTimeout(pollTrack, 1000);
      setView("player");
    } catch (e) { setError(String(e)); }
  };

  // ── Not logged in ────────────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-xs">
          <div className="text-6xl mb-4">🎵</div>
          <h2 className="text-xl font-semibold text-stone-200 mb-2">Spotify</h2>
          <p className="text-stone-500 text-sm mb-6">
            Controlá la música de Spotify sin salir de la app. Requiere cuenta Premium.
          </p>
          {error && (
            <p className="text-red-400 text-xs mb-4 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>
          )}
          <button
            onClick={handleLogin}
            disabled={connecting}
            className="bg-green-600 hover:bg-green-500 disabled:opacity-60 text-white font-semibold px-6 py-3 rounded-full transition-colors"
          >
            {connecting ? "Esperando autorización..." : "Conectar con Spotify"}
          </button>
          {connecting && (
            <p className="text-stone-600 text-xs mt-3">
              Se abrió el browser — autenticá y volvé acá.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Playlists view ────────────────────────────────────────────────────────────
  if (view === "playlists") {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-3 px-6 py-3 border-b border-stone-800 flex-shrink-0">
          <button
            onClick={() => setView("player")}
            className="text-stone-400 hover:text-stone-200 text-sm transition-colors"
          >
            ‹ Volver
          </button>
          <span className="text-stone-300 font-medium">Mis playlists</span>
          <button
            onClick={loadPlaylists}
            disabled={loadingPlaylists}
            className="ml-auto text-xs text-stone-500 hover:text-stone-300 transition-colors"
          >
            {loadingPlaylists ? "Cargando..." : "↻ Recargar"}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {playlists.length === 0 && !loadingPlaylists ? (
            <div className="text-center py-12 text-stone-600 text-sm">
              Sin playlists cargadas.{" "}
              <button onClick={loadPlaylists} className="text-green-400 hover:underline">
                Cargar
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => playPlaylist(pl.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-stone-800/50 transition-colors text-left"
                >
                  {pl.image ? (
                    <img src={pl.image} alt={pl.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-stone-800 flex items-center justify-center flex-shrink-0">
                      <span className="text-2xl">🎵</span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-stone-200 font-medium truncate">{pl.name}</p>
                    <p className="text-stone-500 text-xs">{pl.track_count} canciones</p>
                  </div>
                  <span className="text-stone-600 ml-auto flex-shrink-0">▶</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Player view ───────────────────────────────────────────────────────────────
  const progress = track
    ? Math.min(100, (track.progress_ms / track.duration_ms) * 100)
    : 0;

  return (
    <div className="h-full flex flex-col items-center justify-center gap-0 max-w-sm mx-auto py-8">
      {/* Album art */}
      <div className="w-56 h-56 rounded-2xl overflow-hidden bg-stone-800 mb-6 shadow-2xl flex-shrink-0">
        {track?.album_art ? (
          <img src={track.album_art} alt={track.album} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-6xl">🎵</div>
        )}
      </div>

      {/* Track info */}
      <div className="text-center w-full px-4 mb-4">
        {track ? (
          <>
            <p className="text-stone-100 font-semibold text-lg leading-tight truncate">{track.name}</p>
            <p className="text-stone-400 text-sm truncate mt-0.5">{track.artist}</p>
            <p className="text-stone-600 text-xs truncate">{track.album}</p>
          </>
        ) : (
          <p className="text-stone-600 text-sm">Sin reproducción activa</p>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full px-4 mb-4">
        <div className="h-1 bg-stone-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all duration-1000"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-stone-600 mt-1">
          <span>{track ? formatMs(track.progress_ms) : "0:00"}</span>
          <span>{track ? formatMs(track.duration_ms) : "0:00"}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-6 mb-6">
        <button
          onClick={handlePrev}
          className="text-stone-400 hover:text-stone-100 text-2xl transition-colors"
        >
          ⏮
        </button>
        <button
          onClick={handlePlayPause}
          className="w-14 h-14 bg-white hover:bg-stone-200 text-stone-900 rounded-full flex items-center justify-center text-2xl transition-colors shadow-lg"
        >
          {track?.is_playing ? "⏸" : "▶"}
        </button>
        <button
          onClick={handleNext}
          className="text-stone-400 hover:text-stone-100 text-2xl transition-colors"
        >
          ⏭
        </button>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-3 w-full px-4 mb-6">
        <span className="text-stone-500 text-sm">🔈</span>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(e) => handleVolume(Number(e.target.value))}
          className="flex-1 accent-green-500"
        />
        <span className="text-stone-500 text-sm">🔊</span>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => { setView("playlists"); loadPlaylists(); }}
          className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-full text-sm transition-colors"
        >
          📋 Playlists
        </button>
        <button
          onClick={handleLogout}
          className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-500 rounded-full text-sm transition-colors"
        >
          Desconectar
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-xs mt-4 text-center max-w-xs">{error}</p>
      )}
    </div>
  );
}

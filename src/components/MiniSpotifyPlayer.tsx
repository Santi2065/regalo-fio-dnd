import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSpotifyStore, SPOTIFY_CLIENT_ID } from "../store/spotifyStore";
import { toast } from "../lib/toast";
import { IconButton, Tooltip } from "./ui";

interface Playlist {
  id: string;
  name: string;
  image: string | null;
  track_count: number;
}

function formatMs(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function MiniSpotifyPlayer() {
  const { authenticated, setAuthenticated, track, poll } = useSpotifyStore();
  const [volume, setVolume] = useState(50);
  const [muted, setMuted] = useState(false);
  const prevVolRef = useRef(volume);

  const [connecting, setConnecting] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const pickerRef = useRef<HTMLDivElement | null>(null);

  // ── Load playlists when authenticated ──────────────────────────────────
  const loadPlaylists = useCallback(async () => {
    try {
      const pls = await invoke<Playlist[]>("spotify_get_playlists", {
        clientId: SPOTIFY_CLIENT_ID,
      });
      setPlaylists(pls);
    } catch (e) {
      console.error("[Spotify] loadPlaylists failed", e);
    }
  }, []);

  useEffect(() => {
    if (authenticated) loadPlaylists();
  }, [authenticated, loadPlaylists]);

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [pickerOpen]);

  // ── Commands ───────────────────────────────────────────────────────────
  const cmd = async (command: string) => {
    try {
      await invoke(command, { clientId: SPOTIFY_CLIENT_ID });
      setTimeout(poll, 400);
    } catch (e) {
      console.error(`[Spotify] ${command} failed`, e);
    }
  };

  const handleVolume = async (v: number) => {
    setVolume(v);
    setMuted(v === 0);
    try {
      await invoke("spotify_set_volume", {
        clientId: SPOTIFY_CLIENT_ID,
        volumePercent: v,
      });
    } catch {
      /* silent — Spotify may not be open */
    }
  };

  const toggleMute = async () => {
    try {
      if (muted) {
        const restored = volume > 0 ? volume : 50;
        setMuted(false);
        await invoke("spotify_set_volume", {
          clientId: SPOTIFY_CLIENT_ID,
          volumePercent: restored,
        });
      } else {
        prevVolRef.current = volume;
        setMuted(true);
        await invoke("spotify_set_volume", {
          clientId: SPOTIFY_CLIENT_ID,
          volumePercent: 0,
        });
      }
    } catch {
      /* silent */
    }
  };

  const playPlaylist = async (pl: Playlist) => {
    try {
      await invoke("spotify_play_playlist", {
        clientId: SPOTIFY_CLIENT_ID,
        playlistId: pl.id,
      });
      setSelectedPlaylist(pl);
      setPickerOpen(false);
      setTimeout(poll, 600);
      toast.success(`Reproduciendo "${pl.name}"`, 1800);
    } catch (e) {
      console.error("[Spotify] play playlist failed", e);
      toast.error("No se pudo reproducir la playlist. ¿Spotify abierto?");
    }
  };

  const handleLogin = async () => {
    setConnecting(true);
    try {
      const url = await invoke<string>("spotify_auth_url", { clientId: SPOTIFY_CLIENT_ID });
      await openUrl(url);
      toast.info("Se abrió el navegador. Autorizá y volvé acá.", 4000);
      await invoke<unknown>("spotify_exchange_code", { clientId: SPOTIFY_CLIENT_ID });
      setAuthenticated(true);
      toast.success("Spotify conectado", 1800);
    } catch (e) {
      console.error("[Spotify] login failed", e);
      toast.error("No se pudo conectar con Spotify");
    } finally {
      setConnecting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await invoke("spotify_logout");
      setAuthenticated(false);
      setPlaylists([]);
      setSelectedPlaylist(null);
      toast.info("Spotify desconectado", 1800);
    } catch (e) {
      console.error("[Spotify] logout failed", e);
    }
  };

  const filteredPlaylists = playlists.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const progress = track
    ? Math.min(100, (track.progress_ms / track.duration_ms) * 100)
    : 0;
  const effectiveVol = muted ? 0 : volume;

  // ── Not authenticated: show compact connect bar ─────────────────────────
  if (!authenticated) {
    return (
      <div className="flex-shrink-0 border-t border-parchment-800 bg-parchment-900/80 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-2 h-12">
          <span className="text-success-500 text-base">🎵</span>
          <span className="text-vellum-300 text-xs flex-1">
            Conectá Spotify para controlar la música sin salir de la app
          </span>
          <button
            onClick={handleLogin}
            disabled={connecting}
            className="px-3 py-1 rounded-md text-xs font-medium bg-success-700 hover:bg-success-500 text-vellum-50 transition-colors disabled:opacity-50"
          >
            {connecting ? "Conectando..." : "Conectar Spotify"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 border-t border-parchment-800 bg-parchment-900/80 backdrop-blur">
      {/* Progress bar */}
      <div className="h-1 bg-parchment-800">
        <div
          className="h-full bg-success-500 transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center gap-3 px-3 py-2 h-14">
        {/* Playlist selector (left) */}
        <div className="relative" ref={pickerRef}>
          <Tooltip content="Cambiar playlist" side="top">
            <button
              onClick={() => setPickerOpen((v) => !v)}
              className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-parchment-800 transition-colors max-w-[200px]"
            >
              <div className="w-9 h-9 rounded flex-shrink-0 overflow-hidden bg-parchment-800">
                {selectedPlaylist?.image ? (
                  <img src={selectedPlaylist.image} alt="" className="w-full h-full object-cover" />
                ) : track?.album_art ? (
                  <img src={track.album_art} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-vellum-400 text-xs">
                    ♪
                  </div>
                )}
              </div>
              <div className="hidden md:block min-w-0 text-left">
                <div className="text-[10px] text-vellum-400 leading-none">Playlist</div>
                <div className="text-xs text-vellum-100 truncate font-medium leading-tight">
                  {selectedPlaylist?.name ?? "Elegí una"}
                </div>
              </div>
              <span className="text-vellum-400 text-xs hidden md:block">▾</span>
            </button>
          </Tooltip>

          {pickerOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-72 max-h-80 bg-parchment-900 border border-parchment-700 rounded-lg shadow-candlelight overflow-hidden flex flex-col z-50">
              <div className="p-2 border-b border-parchment-800 flex-shrink-0">
                <input
                  autoFocus
                  type="text"
                  placeholder="Buscar playlist..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-parchment-800 border border-parchment-700 rounded-md px-2 py-1.5 text-xs text-vellum-50 placeholder-vellum-400 focus:outline-none focus:border-gold-500"
                />
              </div>
              <div className="flex-1 overflow-y-auto">
                {filteredPlaylists.length === 0 ? (
                  <p className="text-vellum-400 text-xs text-center py-6 px-3">
                    {playlists.length === 0
                      ? "Cargando playlists..."
                      : "Sin resultados"}
                  </p>
                ) : (
                  filteredPlaylists.map((pl) => (
                    <button
                      key={pl.id}
                      onClick={() => playPlaylist(pl)}
                      className={`flex items-center gap-2 w-full px-2 py-1.5 text-left hover:bg-parchment-800 transition-colors ${
                        selectedPlaylist?.id === pl.id ? "bg-parchment-800/60" : ""
                      }`}
                    >
                      <div className="w-8 h-8 rounded flex-shrink-0 overflow-hidden bg-parchment-800">
                        {pl.image ? (
                          <img src={pl.image} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-vellum-400 text-xs">
                            ♪
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-vellum-100 truncate leading-tight">{pl.name}</p>
                        <p className="text-[10px] text-vellum-400 leading-tight">
                          {pl.track_count} canciones
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
              <div className="border-t border-parchment-800 p-1.5 flex-shrink-0 flex justify-end">
                <button
                  onClick={handleLogout}
                  className="text-[10px] text-vellum-400 hover:text-danger-300 transition-colors px-2 py-1"
                >
                  Desconectar Spotify
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Track info */}
        <div className="flex-1 min-w-0">
          {track ? (
            <>
              <p className="text-xs font-medium text-vellum-100 truncate leading-tight">
                {track.name}
              </p>
              <p className="text-[11px] text-vellum-400 truncate leading-tight">{track.artist}</p>
            </>
          ) : (
            <p className="text-xs text-vellum-400">
              Elegí una playlist para empezar
            </p>
          )}
        </div>

        {/* Time */}
        {track && (
          <span className="text-[11px] text-vellum-400 tabular-nums flex-shrink-0 hidden lg:block">
            {formatMs(track.progress_ms)} / {formatMs(track.duration_ms)}
          </span>
        )}

        {/* Controls */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <IconButton label="Anterior" size="sm" onClick={() => cmd("spotify_previous")}>
            ⏮
          </IconButton>
          <Tooltip content={track?.is_playing ? "Pausar" : "Reproducir"} side="top">
            <button
              onClick={() => cmd("spotify_play_pause")}
              className="w-8 h-8 flex items-center justify-center bg-vellum-50 hover:bg-vellum-100 text-parchment-950 rounded-full transition-colors text-sm"
              aria-label={track?.is_playing ? "Pausar" : "Reproducir"}
            >
              {track?.is_playing ? "⏸" : "▶"}
            </button>
          </Tooltip>
          <IconButton label="Siguiente" size="sm" onClick={() => cmd("spotify_next")}>
            ⏭
          </IconButton>
        </div>

        {/* Volume */}
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-1">
          <button
            onClick={toggleMute}
            className="text-vellum-300 hover:text-vellum-50 transition-colors text-sm w-5 text-center"
            title={muted ? "Desmutear" : "Mutear"}
          >
            {effectiveVol === 0 ? "🔇" : effectiveVol < 40 ? "🔈" : effectiveVol < 75 ? "🔉" : "🔊"}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={effectiveVol}
            onChange={(e) => handleVolume(Number(e.target.value))}
            className="w-20 accent-gold-500 cursor-pointer"
            aria-label="Volumen"
          />
          <span className="text-[10px] text-vellum-400 tabular-nums w-7 text-right hidden sm:block">
            {effectiveVol}%
          </span>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSpotifyStore, SPOTIFY_CLIENT_ID } from "../store/spotifyStore";

interface Playlist {
  id: string;
  name: string;
  image: string | null;
  track_count: number;
}

interface TrackItem {
  id: string;
  uri: string;
  name: string;
  artist: string;
  duration_ms: number;
  track_number: number;
}

function formatMs(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface Props {
  compact?: boolean;
}

export default function SpotifyPanel({ compact = false }: Props) {
  const { authenticated, setAuthenticated, track, poll } = useSpotifyStore();
  const [connecting, setConnecting] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [tracks, setTracks] = useState<TrackItem[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [volume, setVolume] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const loadPlaylists = useCallback(async () => {
    setLoadingPlaylists(true);
    setError(null);
    try {
      const pls = await invoke<Playlist[]>("spotify_get_playlists", {
        clientId: SPOTIFY_CLIENT_ID,
      });
      setPlaylists(pls);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingPlaylists(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated) loadPlaylists();
  }, [authenticated]);

  const selectPlaylist = async (pl: Playlist) => {
    setSelectedPlaylist(pl);
    setTracks([]);
    setSearch("");
    setLoadingTracks(true);
    try {
      const t = await invoke<TrackItem[]>("spotify_get_playlist_tracks", {
        clientId: SPOTIFY_CLIENT_ID,
        playlistId: pl.id,
      });
      setTracks(t);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingTracks(false);
    }
  };

  const playTrack = async (trackUri: string) => {
    if (!selectedPlaylist) return;
    try {
      await invoke("spotify_play_track", {
        clientId: SPOTIFY_CLIENT_ID,
        playlistId: selectedPlaylist.id,
        trackUri,
      });
      setTimeout(poll, 600);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const playPlaylist = async (pl: Playlist) => {
    try {
      await invoke("spotify_play_playlist", {
        clientId: SPOTIFY_CLIENT_ID,
        playlistId: pl.id,
      });
      setTimeout(poll, 600);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleLogin = async () => {
    setConnecting(true);
    setError(null);
    try {
      const url = await invoke<string>("spotify_auth_url", { clientId: SPOTIFY_CLIENT_ID });
      await openUrl(url);
      await invoke<unknown>("spotify_exchange_code", { clientId: SPOTIFY_CLIENT_ID });
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
    setPlaylists([]);
    setSelectedPlaylist(null);
    setTracks([]);
  };

  const handleVolume = async (v: number) => {
    setVolume(v);
    try {
      await invoke("spotify_set_volume", {
        clientId: SPOTIFY_CLIENT_ID,
        volumePercent: v,
      });
    } catch { /* ignore */ }
  };

  const cmd = async (command: string) => {
    try {
      await invoke(command, { clientId: SPOTIFY_CLIENT_ID });
      setTimeout(poll, 400);
    } catch (e) { setError(String(e)); }
  };

  // ── Not logged in ─────────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-xs">
          <div className="text-6xl mb-4">🎵</div>
          <h2 className="text-xl font-semibold text-stone-200 mb-2">Spotify</h2>
          <p className="text-stone-500 text-sm mb-6">
            Controlá la música sin salir de la app. Requiere cuenta Premium y Spotify abierto.
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

  // ── Compact layout ───────────────────────────────────────────────────────
  const filteredTracks = search.trim()
    ? tracks.filter(
        (t) =>
          t.name.toLowerCase().includes(search.toLowerCase()) ||
          t.artist.toLowerCase().includes(search.toLowerCase())
      )
    : tracks;

  const progress = track
    ? Math.min(100, (track.progress_ms / track.duration_ms) * 100)
    : 0;

  if (compact) {
    return (
      <div className="flex flex-col h-full min-h-0">
        {/* Now playing */}
        <div className="px-3 py-2 border-b border-stone-800 flex-shrink-0">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-8 h-8 rounded overflow-hidden bg-stone-800 flex-shrink-0">
              {track?.album_art ? (
                <img src={track.album_art} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-stone-600 text-xs">♪</div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              {track ? (
                <>
                  <p className="text-xs font-medium text-stone-200 truncate leading-tight">{track.name}</p>
                  <p className="text-xs text-stone-500 truncate leading-tight">{track.artist}</p>
                </>
              ) : (
                <p className="text-xs text-stone-600">Sin reproducción</p>
              )}
            </div>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button onClick={() => cmd("spotify_previous")} className="w-6 h-6 flex items-center justify-center text-stone-400 hover:text-stone-100 rounded hover:bg-stone-800 transition-colors text-xs">⏮</button>
              <button onClick={() => cmd("spotify_play_pause")} className="w-7 h-7 flex items-center justify-center bg-white hover:bg-stone-200 text-stone-900 rounded-full transition-colors text-xs">
                {track?.is_playing ? "⏸" : "▶"}
              </button>
              <button onClick={() => cmd("spotify_next")} className="w-6 h-6 flex items-center justify-center text-stone-400 hover:text-stone-100 rounded hover:bg-stone-800 transition-colors text-xs">⏭</button>
            </div>
          </div>
          {/* Progress */}
          <div className="h-0.5 bg-stone-800 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 transition-all duration-1000" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Playlist dropdown + search */}
        <div className="px-2 py-2 border-b border-stone-800 flex-shrink-0 flex items-center gap-1.5">
          <select
            value={selectedPlaylist?.id ?? ""}
            onChange={(e) => {
              const pl = playlists.find((p) => p.id === e.target.value);
              if (pl) selectPlaylist(pl);
            }}
            className="flex-1 bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 focus:outline-none focus:border-green-600 min-w-0"
          >
            <option value="" disabled>{loadingPlaylists ? "Cargando..." : "Seleccioná playlist"}</option>
            {playlists.map((pl) => (
              <option key={pl.id} value={pl.id}>{pl.name}</option>
            ))}
          </select>
          {selectedPlaylist && (
            <button
              onClick={() => playPlaylist(selectedPlaylist)}
              className="text-green-400 hover:text-green-300 text-xs px-1.5 py-1 rounded hover:bg-stone-800 transition-colors flex-shrink-0"
              title="Reproducir playlist"
            >
              ▶
            </button>
          )}
        </div>

        {selectedPlaylist && (
          <div className="px-2 py-1.5 border-b border-stone-800/50 flex-shrink-0">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 placeholder-stone-600 focus:outline-none focus:border-stone-500"
            />
          </div>
        )}

        {/* Track list */}
        <div className="flex-1 overflow-y-auto">
          {loadingTracks ? (
            <p className="text-stone-600 text-xs p-4 text-center animate-pulse">Cargando...</p>
          ) : !selectedPlaylist ? (
            <p className="text-stone-600 text-xs p-4 text-center">Seleccioná una playlist</p>
          ) : filteredTracks.length === 0 ? (
            <p className="text-stone-600 text-xs p-4 text-center">Sin resultados</p>
          ) : (
            filteredTracks.map((t) => {
              const isCurrent = track?.id === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => playTrack(t.uri)}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-stone-800/30 transition-colors ${isCurrent ? "bg-green-900/20" : "hover:bg-stone-800/40"}`}
                >
                  <span className={`text-xs w-4 flex-shrink-0 text-center ${isCurrent ? "text-green-400" : "text-stone-600"}`}>
                    {isCurrent ? (track?.is_playing ? "▶" : "⏸") : ""}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs truncate ${isCurrent ? "text-green-300 font-medium" : "text-stone-300"}`}>{t.name}</p>
                    <p className="text-xs text-stone-600 truncate">{t.artist}</p>
                  </div>
                  <span className="text-xs text-stone-700 flex-shrink-0 tabular-nums">{formatMs(t.duration_ms)}</span>
                </div>
              );
            })
          )}
        </div>

        {/* Logout */}
        <div className="px-3 py-2 border-t border-stone-800 flex-shrink-0">
          <button onClick={handleLogout} className="w-full text-xs text-stone-600 hover:text-stone-400 transition-colors">
            Desconectar
          </button>
        </div>

        {error && (
          <div className="px-3 py-1.5 text-red-400 text-xs bg-red-900/10 border-t border-red-900/30 flex-shrink-0">{error}</div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* ── Left: playlists column ──────────────────────────────────────── */}
      <div className="w-64 flex-shrink-0 border-r border-stone-800 flex flex-col bg-stone-900/30">
        <div className="px-4 py-3 border-b border-stone-800 flex items-center gap-2">
          <span className="text-sm font-medium text-stone-300 flex-1">Playlists</span>
          <button
            onClick={loadPlaylists}
            disabled={loadingPlaylists}
            className="text-xs text-stone-600 hover:text-stone-300 transition-colors"
            title="Recargar"
          >
            ↻
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingPlaylists ? (
            <p className="text-stone-600 text-xs p-4 text-center animate-pulse">Cargando...</p>
          ) : playlists.length === 0 ? (
            <p className="text-stone-600 text-xs p-4 text-center">Sin playlists</p>
          ) : (
            playlists.map((pl) => (
              <div
                key={pl.id}
                className={`group flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors border-l-2 ${
                  selectedPlaylist?.id === pl.id
                    ? "bg-stone-800/60 border-l-green-500"
                    : "border-l-transparent hover:bg-stone-800/30"
                }`}
                onClick={() => selectPlaylist(pl)}
              >
                {pl.image ? (
                  <img
                    src={pl.image}
                    alt={pl.name}
                    className="w-9 h-9 rounded flex-shrink-0 object-cover"
                  />
                ) : (
                  <div className="w-9 h-9 rounded bg-stone-700 flex items-center justify-center flex-shrink-0 text-base">
                    🎵
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-stone-200 truncate font-medium">{pl.name}</p>
                  <p className="text-xs text-stone-600">{pl.track_count} canciones</p>
                </div>
                {/* Play whole playlist button */}
                <button
                  onClick={(e) => { e.stopPropagation(); playPlaylist(pl); }}
                  className="opacity-0 group-hover:opacity-100 text-green-400 hover:text-green-300 text-xs transition-all flex-shrink-0"
                  title="Reproducir playlist"
                >
                  ▶
                </button>
              </div>
            ))
          )}
        </div>

        {/* Logout */}
        <div className="p-3 border-t border-stone-800">
          <button
            onClick={handleLogout}
            className="w-full text-xs text-stone-600 hover:text-stone-400 transition-colors py-1"
          >
            Desconectar Spotify
          </button>
        </div>
      </div>

      {/* ── Right: now playing + track list ─────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Now playing header */}
        <div className="flex items-center gap-4 px-5 py-3 border-b border-stone-800 flex-shrink-0 bg-stone-900/20">
          {/* Mini album art */}
          <div className="w-10 h-10 rounded overflow-hidden bg-stone-800 flex-shrink-0">
            {track?.album_art ? (
              <img src={track.album_art} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-stone-600">♪</div>
            )}
          </div>

          {/* Track info */}
          <div className="flex-1 min-w-0">
            {track ? (
              <>
                <p className="text-sm font-medium text-stone-100 truncate">{track.name}</p>
                <p className="text-xs text-stone-400 truncate">{track.artist}</p>
              </>
            ) : (
              <p className="text-sm text-stone-600">Sin reproducción activa</p>
            )}
            {/* Progress */}
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1 bg-stone-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all duration-1000"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-stone-600 tabular-nums flex-shrink-0">
                {track ? `${formatMs(track.progress_ms)} / ${formatMs(track.duration_ms)}` : "–"}
              </span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => cmd("spotify_previous")}
              className="w-7 h-7 flex items-center justify-center text-stone-400 hover:text-stone-100 rounded hover:bg-stone-800 transition-colors"
            >
              <span className="text-sm">⏮</span>
            </button>
            <button
              onClick={() => cmd("spotify_play_pause")}
              className="w-9 h-9 flex items-center justify-center bg-white hover:bg-stone-200 text-stone-900 rounded-full transition-colors"
            >
              {track?.is_playing ? "⏸" : "▶"}
            </button>
            <button
              onClick={() => cmd("spotify_next")}
              className="w-7 h-7 flex items-center justify-center text-stone-400 hover:text-stone-100 rounded hover:bg-stone-800 transition-colors"
            >
              <span className="text-sm">⏭</span>
            </button>
            {/* Volume */}
            <div className="flex items-center gap-1.5 ml-2">
              <span className="text-stone-600 text-xs">🔈</span>
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={(e) => handleVolume(Number(e.target.value))}
                className="w-20 accent-green-500"
              />
              <span className="text-stone-600 text-xs">🔊</span>
            </div>
          </div>
        </div>

        {/* Track list */}
        <div className="flex-1 flex flex-col min-h-0">
          {!selectedPlaylist ? (
            <div className="flex-1 flex items-center justify-center text-stone-600 text-sm">
              Seleccioná una playlist para ver las canciones
            </div>
          ) : (
            <>
              {/* Playlist header + search */}
              <div className="flex items-center gap-3 px-5 py-2.5 border-b border-stone-800/60 flex-shrink-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-stone-200 truncate">
                    {selectedPlaylist.name}
                  </p>
                  <p className="text-xs text-stone-600">{tracks.length} canciones</p>
                </div>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar en playlist..."
                  className="bg-stone-800 border border-stone-700 rounded-lg px-3 py-1 text-xs text-stone-200 placeholder-stone-600 focus:outline-none focus:border-stone-500 w-44"
                />
              </div>

              {/* Tracks */}
              <div className="flex-1 overflow-y-auto">
                {loadingTracks ? (
                  <p className="text-stone-600 text-xs p-6 text-center animate-pulse">
                    Cargando canciones...
                  </p>
                ) : filteredTracks.length === 0 ? (
                  <p className="text-stone-600 text-xs p-6 text-center">Sin resultados</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-stone-950/80 backdrop-blur-sm">
                      <tr className="text-stone-600 border-b border-stone-800">
                        <th className="text-right px-4 py-2 w-10 font-normal">#</th>
                        <th className="text-left px-3 py-2 font-normal">Canción</th>
                        <th className="text-left px-3 py-2 font-normal hidden md:table-cell">Artista</th>
                        <th className="text-right px-4 py-2 font-normal">⏱</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTracks.map((t) => {
                        const isCurrentTrack = track?.id === t.id;
                        return (
                          <tr
                            key={t.id}
                            onClick={() => playTrack(t.uri)}
                            className={`group cursor-pointer transition-colors border-b border-stone-800/30 ${
                              isCurrentTrack
                                ? "bg-green-900/20 text-green-300"
                                : "hover:bg-stone-800/40 text-stone-300"
                            }`}
                          >
                            <td className="text-right px-4 py-2.5 tabular-nums text-stone-600 w-10">
                              {isCurrentTrack ? (
                                <span className="text-green-400">
                                  {track?.is_playing ? "▶" : "⏸"}
                                </span>
                              ) : (
                                <span className="group-hover:hidden">{t.track_number}</span>
                              )}
                              {!isCurrentTrack && (
                                <span className="hidden group-hover:inline text-green-400">▶</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 truncate max-w-0 w-full">
                              <span className={isCurrentTrack ? "text-green-300 font-medium" : ""}>
                                {t.name}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-stone-500 truncate hidden md:table-cell">
                              {t.artist}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-stone-600 whitespace-nowrap">
                              {formatMs(t.duration_ms)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>

        {error && (
          <div className="px-5 py-2 text-red-400 text-xs bg-red-900/10 border-t border-red-900/30 flex-shrink-0">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

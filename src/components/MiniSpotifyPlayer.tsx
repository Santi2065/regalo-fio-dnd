import { invoke } from "@tauri-apps/api/core";
import { useSpotifyStore, SPOTIFY_CLIENT_ID } from "../store/spotifyStore";

function formatMs(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function MiniSpotifyPlayer() {
  const { track, poll } = useSpotifyStore();

  const cmd = async (command: string) => {
    await invoke(command, { clientId: SPOTIFY_CLIENT_ID });
    setTimeout(poll, 400);
  };

  const progress = track
    ? Math.min(100, (track.progress_ms / track.duration_ms) * 100)
    : 0;

  return (
    <div className="flex-shrink-0 border-t border-stone-800 bg-stone-900/80 backdrop-blur-sm">
      {/* Progress bar at very top */}
      <div className="h-0.5 bg-stone-800">
        <div
          className="h-full bg-green-500 transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center gap-3 px-4 py-2 h-14">
        {/* Album art */}
        <div className="w-9 h-9 rounded flex-shrink-0 overflow-hidden bg-stone-800">
          {track?.album_art ? (
            <img src={track.album_art} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-stone-600 text-xs">♪</div>
          )}
        </div>

        {/* Track info */}
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

        {/* Time */}
        {track && (
          <span className="text-xs text-stone-600 tabular-nums flex-shrink-0 hidden sm:block">
            {formatMs(track.progress_ms)} / {formatMs(track.duration_ms)}
          </span>
        )}

        {/* Controls */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => cmd("spotify_previous")}
            className="w-7 h-7 flex items-center justify-center text-stone-400 hover:text-stone-100 transition-colors rounded hover:bg-stone-800"
          >
            <span className="text-sm">⏮</span>
          </button>
          <button
            onClick={() => cmd("spotify_play_pause")}
            className="w-8 h-8 flex items-center justify-center bg-white hover:bg-stone-200 text-stone-900 rounded-full transition-colors text-sm"
          >
            {track?.is_playing ? "⏸" : "▶"}
          </button>
          <button
            onClick={() => cmd("spotify_next")}
            className="w-7 h-7 flex items-center justify-center text-stone-400 hover:text-stone-100 transition-colors rounded hover:bg-stone-800"
          >
            <span className="text-sm">⏭</span>
          </button>
        </div>
      </div>
    </div>
  );
}

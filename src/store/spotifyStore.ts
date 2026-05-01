import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export const SPOTIFY_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string;

export interface SpotifyTrack {
  id: string;
  name: string;
  artist: string;
  album: string;
  album_art: string | null;
  duration_ms: number;
  progress_ms: number;
  is_playing: boolean;
}

interface SpotifyStore {
  authenticated: boolean;
  track: SpotifyTrack | null;
  /** Última vez que `poll` falló y la causa. null si nunca falló o ya recuperó. */
  lastError: string | null;
  setAuthenticated: (v: boolean) => void;
  setTrack: (t: SpotifyTrack | null) => void;
  poll: () => Promise<void>;
}

export const useSpotifyStore = create<SpotifyStore>((set, get) => ({
  authenticated: false,
  track: null,
  lastError: null,
  setAuthenticated: (v) => set({ authenticated: v, lastError: v ? null : get().lastError }),
  setTrack: (t) => set({ track: t }),
  poll: async () => {
    if (!get().authenticated) return;
    try {
      const t = await invoke<SpotifyTrack | null>("spotify_current_track", {
        clientId: SPOTIFY_CLIENT_ID,
      });
      const prev = get().track;
      // Skip the store update when nothing visible has changed. Progress drifts
      // every tick, so a tolerance lets paused/idle ticks short-circuit.
      if (
        prev?.id === t?.id &&
        prev?.is_playing === t?.is_playing &&
        Math.abs((prev?.progress_ms ?? 0) - (t?.progress_ms ?? 0)) < 1500
      ) {
        // Mismo track sin cambios — limpiamos el error si lo había.
        if (get().lastError) set({ lastError: null });
        return;
      }
      set({ track: t, lastError: null });
    } catch (e) {
      // Ya no se traga silencioso: el user va a ver "Sin reproducción activa"
      // en la UI y este log ayuda a diagnosticar refresh tokens corruptos,
      // rate limits, scopes faltantes, etc.
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[spotify poll]", msg);
      set({ lastError: msg });
    }
  },
}));

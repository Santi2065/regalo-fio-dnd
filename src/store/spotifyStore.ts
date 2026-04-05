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
  setAuthenticated: (v: boolean) => void;
  setTrack: (t: SpotifyTrack | null) => void;
  poll: () => Promise<void>;
}

export const useSpotifyStore = create<SpotifyStore>((set, get) => ({
  authenticated: false,
  track: null,
  setAuthenticated: (v) => set({ authenticated: v }),
  setTrack: (t) => set({ track: t }),
  poll: async () => {
    if (!get().authenticated) return;
    try {
      const t = await invoke<SpotifyTrack | null>("spotify_current_track", {
        clientId: SPOTIFY_CLIENT_ID,
      });
      set({ track: t });
    } catch {
      // ignore (e.g. Spotify not open)
    }
  },
}));

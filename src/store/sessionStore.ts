import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../lib/types";

interface SessionStore {
  sessions: Session[];
  loading: boolean;
  fetchSessions: () => Promise<void>;
  createSession: (name: string, description?: string) => Promise<Session>;
  updateSession: (id: string, name: string, description?: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  loading: false,

  fetchSessions: async () => {
    set({ loading: true });
    try {
      const sessions = await invoke<Session[]>("get_sessions");
      set({ sessions });
    } finally {
      set({ loading: false });
    }
  },

  createSession: async (name, description) => {
    const session = await invoke<Session>("create_session", { name, description: description ?? null });
    set((s) => ({ sessions: [session, ...s.sessions] }));
    return session;
  },

  updateSession: async (id, name, description) => {
    const updated = await invoke<Session>("update_session", { id, name, description: description ?? null });
    set((s) => ({
      sessions: s.sessions.map((sess) => (sess.id === id ? updated : sess)),
    }));
  },

  deleteSession: async (id) => {
    await invoke("delete_session", { id });
    set((s) => ({ sessions: s.sessions.filter((sess) => sess.id !== id) }));
  },
}));

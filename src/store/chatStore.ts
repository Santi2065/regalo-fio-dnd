import { create } from "zustand";
import type { ChatMessage } from "../lib/companion";

/**
 * Chat store del DM (v1.6 sub-proyecto D.3.6).
 *
 * El DM ve TODOS los mensajes de la sesión, incluso los whispers entre
 * players (los players no saben que el DM los ve). El store organiza los
 * mensajes en "threads" según el par de participantes.
 *
 * Para un DM, un "thread key" es:
 * - "dm:<player_token>" — conversación entre el DM y ese player.
 * - "p:<token_a>|<token_b>" — whisper entre dos players (siempre con tokens
 *   en orden alfabético para que A→B y B→A pertenezcan al mismo thread).
 */

export type ThreadKey = string;

export function threadKeyForMessage(msg: ChatMessage): ThreadKey | null {
  // Caso 1: DM ↔ player (en cualquier dirección).
  if (msg.sender_kind === "dm" && msg.recipient_kind === "player" && msg.recipient_token) {
    return `dm:${msg.recipient_token}`;
  }
  if (msg.sender_kind === "player" && msg.recipient_kind === "dm" && msg.sender_token) {
    return `dm:${msg.sender_token}`;
  }
  // Caso 2: whisper player ↔ player.
  if (
    msg.sender_kind === "player" &&
    msg.recipient_kind === "player" &&
    msg.sender_token &&
    msg.recipient_token
  ) {
    const [a, b] = [msg.sender_token, msg.recipient_token].sort();
    return `p:${a}|${b}`;
  }
  return null;
}

interface ChatStore {
  threads: Record<ThreadKey, ChatMessage[]>;
  /** Última lectura por thread, en milisegundos epoch. */
  lastRead: Record<ThreadKey, number>;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  markThreadRead: (key: ThreadKey) => void;
  clear: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  threads: {},
  lastRead: {},

  /** Hidrata el store al cargar la sesión. Reemplaza todo el state. */
  setMessages: (messages) => {
    const threads: Record<ThreadKey, ChatMessage[]> = {};
    for (const m of messages) {
      const key = threadKeyForMessage(m);
      if (!key) continue;
      if (!threads[key]) threads[key] = [];
      threads[key].push(m);
    }
    set({ threads });
  },

  /** Agrega un mensaje nuevo (push a su thread). Idempotente por chat_id. */
  addMessage: (message) => {
    const key = threadKeyForMessage(message);
    if (!key) return;
    set((state) => {
      const existing = state.threads[key] ?? [];
      if (existing.some((m) => m.id === message.id)) return state;
      return {
        threads: {
          ...state.threads,
          [key]: [...existing, message],
        },
      };
    });
  },

  markThreadRead: (key) =>
    set((state) => ({
      lastRead: { ...state.lastRead, [key]: Date.now() },
    })),

  clear: () => set({ threads: {}, lastRead: {} }),
}));

/** Cuenta de mensajes sin leer en un thread. */
export function unreadCount(messages: ChatMessage[], lastReadMs: number | undefined): number {
  if (!lastReadMs) return messages.length > 0 ? messages.length : 0;
  return messages.filter((m) => new Date(m.sent_at).getTime() > lastReadMs).length;
}

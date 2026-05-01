import { useEffect, useMemo, useRef, useState } from "react";
import { companionGetChats, companionSendChat } from "../../lib/companion";
import type { ConnectedPlayer } from "../../lib/companion";
import {
  useChatStore,
  unreadCount,
  type ThreadKey,
} from "../../store/chatStore";
import { toast } from "../../lib/toast";

interface Props {
  open: boolean;
  sessionId: string;
  /** Players actualmente conectados — viene del companion status. */
  connectedPlayers: ConnectedPlayer[];
  onClose: () => void;
}

/**
 * Panel flotante de chat para el DM.
 *
 * Muestra TODOS los chats de la sesión, incluyendo whispers player↔player
 * que los players creen privados. Esto es el feature key — los players
 * juegan con la sensación de tener secretos pero el DM siempre tiene
 * contexto narrativo.
 *
 * Layout:
 *  - Sidebar izquierda con lista de threads.
 *  - Panel derecho con timeline + input (deshabilitado para whispers
 *    P↔P, solo lectura — el DM no puede inventar mensajes "como otro
 *    player").
 */
export default function ChatPanel({ open, sessionId, connectedPlayers, onClose }: Props) {
  const { threads, lastRead, setMessages, markThreadRead } = useChatStore();
  const [activeKey, setActiveKey] = useState<ThreadKey | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);

  // Hidratar threads al abrir el panel (o cambiar de sesión).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const messages = await companionGetChats(sessionId);
        if (cancelled) return;
        setMessages(messages);
      } catch (e) {
        console.error("[ChatPanel] load chats failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, setMessages]);

  // Auto-scroll al final del thread cuando llega un mensaje nuevo.
  useEffect(() => {
    if (!activeKey) return;
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeKey, threads]);

  // Marcar como leído al ver el thread.
  useEffect(() => {
    if (activeKey) markThreadRead(activeKey);
  }, [activeKey, markThreadRead]);

  const playersByToken = useMemo(() => {
    const map = new Map<string, ConnectedPlayer>();
    for (const p of connectedPlayers) map.set(p.token, p);
    return map;
  }, [connectedPlayers]);

  // Lista de threads ordenados: primero los de DM↔player (en orden de
  // connectedPlayers), después los whispers.
  const threadList = useMemo(() => {
    const dmThreads: { key: ThreadKey; label: string; sub: string; spy: boolean }[] = [];
    const whisperThreads: { key: ThreadKey; label: string; sub: string; spy: boolean }[] = [];

    // DM ↔ player threads — siempre mostramos uno por player conectado,
    // aunque no tenga mensajes todavía.
    for (const p of connectedPlayers) {
      const key: ThreadKey = `dm:${p.token}`;
      dmThreads.push({
        key,
        label: p.character.name,
        sub: "Privado con vos",
        spy: false,
      });
    }

    // Whispers entre players — derivados de los threads existentes.
    for (const key of Object.keys(threads)) {
      if (!key.startsWith("p:")) continue;
      const [aToken, bToken] = key.slice(2).split("|");
      const a = playersByToken.get(aToken)?.character.name ?? "(desconectado)";
      const b = playersByToken.get(bToken)?.character.name ?? "(desconectado)";
      whisperThreads.push({
        key,
        label: `${a} ⇋ ${b}`,
        sub: "🕵 Espías esta conversación",
        spy: true,
      });
    }

    return [...dmThreads, ...whisperThreads];
  }, [connectedPlayers, threads, playersByToken]);

  const activeThread = activeKey ? threads[activeKey] ?? [] : [];
  const activeMeta = threadList.find((t) => t.key === activeKey);
  const canSend = activeKey?.startsWith("dm:") ?? false;

  const handleSend = async () => {
    if (!canSend || !activeKey) return;
    const content = draft.trim();
    if (!content || sending) return;
    const recipientToken = activeKey.slice(3); // strip "dm:"
    setSending(true);
    try {
      await companionSendChat(sessionId, recipientToken, content);
      setDraft("");
      // El mensaje aparece via Tauri event (companion-event) — no lo
      // agregamos manualmente para evitar duplicados.
    } catch (e) {
      console.error("[ChatPanel] send failed", e);
      toast.error("No se pudo enviar el mensaje");
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed top-0 right-0 bottom-0 w-[420px] max-w-full bg-parchment-950 border-l border-parchment-700 shadow-2xl z-40 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-parchment-800 flex-shrink-0">
        <h3 className="text-vellum-100 font-semibold text-sm flex-1">💬 Chat de mesa</h3>
        <span className="text-vellum-400 text-[10px] hidden sm:inline" title="Los players no saben que vos ves los whispers entre ellos">
          🕵 ves todo
        </span>
        <button
          onClick={onClose}
          className="text-vellum-400 hover:text-vellum-100 text-lg leading-none px-1"
          aria-label="Cerrar chat"
        >
          ×
        </button>
      </div>

      {/* Body: sidebar (threads) + main (current thread) */}
      <div className="flex flex-1 min-h-0">
        {/* Threads sidebar */}
        <div className="w-32 sm:w-40 flex-shrink-0 border-r border-parchment-800 overflow-y-auto bg-parchment-900/40">
          {threadList.length === 0 ? (
            <p className="text-vellum-500 text-xs p-3">
              Sin players conectados. Activá el companion y esperá a que se conecten.
            </p>
          ) : (
            threadList.map((t) => {
              const messages = threads[t.key] ?? [];
              const lastMsg = messages[messages.length - 1];
              const unread = unreadCount(messages, lastRead[t.key]);
              const isActive = activeKey === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveKey(t.key)}
                  className={`w-full text-left px-3 py-2 border-b border-parchment-800/60 transition-colors ${
                    isActive ? "bg-amber-900/30" : "hover:bg-parchment-800/40"
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-vellum-100 truncate flex-1 font-medium">
                      {t.label}
                    </span>
                    {unread > 0 && (
                      <span className="bg-gold-500 text-parchment-950 text-[10px] rounded-full px-1.5 py-0 min-w-4 text-center font-medium">
                        {unread}
                      </span>
                    )}
                  </div>
                  <p className={`text-[10px] truncate mt-0.5 ${t.spy ? "text-copper-400" : "text-vellum-500"}`}>
                    {lastMsg ? lastMsg.content : t.sub}
                  </p>
                </button>
              );
            })
          )}
        </div>

        {/* Active thread */}
        <div className="flex-1 flex flex-col min-w-0">
          {!activeKey ? (
            <div className="flex-1 flex items-center justify-center p-4 text-center">
              <p className="text-vellum-500 text-sm">
                Elegí una conversación para verla.
              </p>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="px-3 py-2 border-b border-parchment-800 flex-shrink-0">
                <p className="text-vellum-100 text-sm font-medium truncate">
                  {activeMeta?.label}
                </p>
                <p className={`text-[10px] truncate ${activeMeta?.spy ? "text-copper-400" : "text-vellum-500"}`}>
                  {activeMeta?.sub}
                </p>
              </div>

              {/* Messages */}
              <div
                ref={threadRef}
                className="flex-1 overflow-y-auto p-3 flex flex-col gap-2"
              >
                {activeThread.length === 0 ? (
                  <p className="text-vellum-500 text-xs text-center py-8">
                    Sin mensajes todavía.
                    {canSend ? " Escribí abajo para empezar." : ""}
                  </p>
                ) : (
                  activeThread.map((m) => {
                    const isDmSender = m.sender_kind === "dm";
                    const align = isDmSender ? "items-end" : "items-start";
                    const bg = isDmSender
                      ? "bg-gold-700/40 border-gold-700/40"
                      : "bg-parchment-800/60 border-parchment-700";
                    const time = new Date(m.sent_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    return (
                      <div key={m.id} className={`flex flex-col ${align}`}>
                        <div className={`max-w-[85%] rounded-lg border px-3 py-1.5 ${bg}`}>
                          <p className="text-[10px] text-vellum-400 mb-0.5">
                            {m.sender_name} → {m.recipient_name} · {time}
                          </p>
                          <p className="text-xs text-vellum-100 break-words whitespace-pre-wrap">
                            {m.content}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Input */}
              {canSend ? (
                <div className="border-t border-parchment-800 p-2 flex gap-2 flex-shrink-0">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={`Mensaje a ${activeMeta?.label}...`}
                    maxLength={2000}
                    disabled={sending}
                    className="flex-1 bg-parchment-800 border border-parchment-700 rounded px-2 py-1.5 text-xs text-vellum-100 focus:outline-none focus:border-gold-600 disabled:opacity-50"
                  />
                  <button
                    onClick={handleSend}
                    disabled={sending || !draft.trim()}
                    className="px-3 py-1.5 bg-gold-600 hover:bg-gold-500 text-parchment-950 rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sending ? "..." : "Enviar"}
                  </button>
                </div>
              ) : (
                <div className="border-t border-parchment-800 px-3 py-2 flex-shrink-0 bg-parchment-900/40">
                  <p className="text-vellum-500 text-[11px] italic text-center">
                    🕵 Solo lectura — los players creen que esta conversación es privada entre ellos
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

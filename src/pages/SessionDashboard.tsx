import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSessionStore } from "../store/sessionStore";
import { useSpotifyStore } from "../store/spotifyStore";
import LibraryBrowser from "../components/LibraryBrowser";
import NotesPanel from "../components/NotesPanel";
import SoundboardPanel from "../components/SoundboardPanel";
import DisplayPanel from "../components/DisplayPanel";
import GuionEditor from "../components/GuionEditor";
import InitiativeTracker from "../components/InitiativeTracker";
import MiniSpotifyPlayer from "../components/MiniSpotifyPlayer";
import CharacterSheets from "../components/CharacterSheets";
import HelpModal from "../components/HelpModal";
import DiceOverlay from "../components/DiceOverlay";
import GeneratorOverlay from "../components/GeneratorOverlay";
import ManualSearch from "../components/ManualSearch";
import CompanionDialog from "../components/CompanionDialog";
import SendHandoutDialog from "../components/SendHandoutDialog";
import ChatPanel from "../components/companion/ChatPanel";
import type { CompanionStatus, ChatMessage } from "../lib/companion";
import {
  companionStatus as fetchCompanionStatus,
  companionGetChats,
} from "../lib/companion";
import { useChatStore, unreadCount } from "../store/chatStore";
import type { Session } from "../lib/types";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "../lib/toast";
import { readJSON, writeJSON } from "../lib/persistence";
import { IconButton, Tooltip } from "../components/ui";
import { useSoundTriggerEngine } from "../lib/useSoundTriggerEngine";
import { useLiveStateStore } from "../store/liveStateStore";

type MainSection = "guion" | "assets" | "personajes";
type ToolTab = "soundboard" | "display" | "initiative" | "notes";
type Mode = "prep" | "live";
type PanelSize = "sm" | "md" | "lg";

const PANEL_SIZES: Record<PanelSize, number> = { sm: 320, md: 400, lg: 480 };
const LS_KEY = "dnd-dashboard-v2";

function loadPrefs(): Record<string, unknown> {
  return readJSON<Record<string, unknown>>(LS_KEY, {});
}

function savePrefs(patch: Record<string, unknown>) {
  writeJSON(LS_KEY, { ...loadPrefs(), ...patch });
}

const MAIN_NAV: { key: MainSection; icon: string; label: string; shortcut: string }[] = [
  { key: "guion", icon: "📜", label: "Guión", shortcut: "Ctrl+1" },
  { key: "assets", icon: "🗃", label: "Biblioteca", shortcut: "Ctrl+2" },
  { key: "personajes", icon: "👤", label: "Fichas", shortcut: "Ctrl+3" },
];

const TOOL_TABS: { key: ToolTab; icon: string; label: string; shortcut: string }[] = [
  { key: "soundboard", icon: "🔊", label: "Sonido", shortcut: "Ctrl+4" },
  { key: "display", icon: "🖥", label: "Proyección", shortcut: "Ctrl+5" },
  { key: "initiative", icon: "⚔", label: "Iniciativa", shortcut: "Ctrl+6" },
  { key: "notes", icon: "📝", label: "Notas", shortcut: "Ctrl+7" },
];

export default function SessionDashboard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { sessions, fetchSessions, updateSession } = useSessionStore();
  const { authenticated, setAuthenticated, poll } = useSpotifyStore();
  const [session, setSession] = useState<Session | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");

  // ── Persisted UI state ─────────────────────────────────────────────────
  const prefs = loadPrefs();
  const [mainSection, setMainSection] = useState<MainSection>(
    (prefs.mainSection as MainSection) ?? "guion"
  );
  const [toolTab, setToolTab] = useState<ToolTab>(
    (prefs.toolTab as ToolTab) ?? "soundboard"
  );
  const [collapsed, setCollapsed] = useState<boolean>((prefs.collapsed as boolean) ?? false);
  const [panelSize, setPanelSize] = useState<PanelSize>(
    (prefs.panelSize as PanelSize) ?? "md"
  );
  const [mode, setMode] = useState<Mode>("prep");
  const [helpOpen, setHelpOpen] = useState(false);
  const [diceOpen, setDiceOpen] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [manualSearchOpen, setManualSearchOpen] = useState(false);
  const [companionOpen, setCompanionOpen] = useState(false);
  const [companion, setCompanion] = useState<CompanionStatus | null>(null);
  const [handoutOpen, setHandoutOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Persist prefs ──────────────────────────────────────────────────────
  useEffect(() => savePrefs({ mainSection }), [mainSection]);
  useEffect(() => savePrefs({ toolTab }), [toolTab]);
  useEffect(() => savePrefs({ collapsed }), [collapsed]);
  useEffect(() => savePrefs({ panelSize }), [panelSize]);

  // ── Data loading ───────────────────────────────────────────────────────
  useEffect(() => {
    if (sessions.length === 0) fetchSessions();
  }, []);

  useEffect(() => {
    const found = sessions.find((s) => s.id === id);
    if (found) {
      setSession(found);
      setEditName(found.name);
    }
  }, [sessions, id]);

  useEffect(() => {
    invoke<{ authenticated: boolean }>("spotify_status").then(({ authenticated: auth }) => {
      setAuthenticated(auth);
    });
  }, []);

  // Hidratamos el companion status al montar — el server podría seguir vivo
  // de un dialog previo (p.ej. después de un hot-reload del frontend).
  useEffect(() => {
    fetchCompanionStatus()
      .then(setCompanion)
      .catch((e) => console.error("[Dashboard] companion status failed", e));
  }, []);

  // Escuchar eventos del companion (dice rolls + chat de los players).
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<
        | {
            type: "dice_roll";
            from_name: string;
            expression: string;
            total: number;
            breakdown: string;
          }
        | ({ type: "chat" } & ChatMessage & {
            // El payload de DmEvent::Chat tiene `chat_id` no `id`. Lo
            // mapeamos al guardar.
            chat_id: string;
          })
        | { type: "player_connected" | "player_disconnected"; token: string; name: string }
      >("companion-event", (event) => {
        const p = event.payload;
        if (p.type === "dice_roll") {
          toast.info(`🎲 ${p.from_name}: ${p.expression} = ${p.total}`, 5000);
        } else if (p.type === "chat") {
          // Sumar al chatStore. Mapear chat_id → id para que coincida con
          // el shape de ChatMessage que devuelve companion_get_chats.
          const msg: ChatMessage = {
            id: p.chat_id,
            session_id: "", // el evento no incluye session_id pero estamos en la sesión activa
            sender_kind: p.sender_kind,
            sender_token: p.sender_token,
            sender_name: p.sender_name,
            recipient_kind: p.recipient_kind,
            recipient_token: p.recipient_token,
            recipient_name: p.recipient_name,
            content: p.content,
            sent_at: p.sent_at,
          };
          useChatStore.getState().addMessage(msg);
          // Toast solo si el panel está cerrado, para no doble-notificar.
          if (!chatOpen) {
            const isWhisper = p.sender_kind === "player" && p.recipient_kind === "player";
            const prefix = isWhisper ? "🕵" : "💬";
            toast.info(
              `${prefix} ${p.sender_name} → ${p.recipient_name}: ${p.content.slice(0, 60)}${p.content.length > 60 ? "..." : ""}`,
              4000,
            );
          }
        }
      }).then((un) => {
        unlistenFn = un;
      });
    });
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, [chatOpen]);

  // Reset del chat store al cambiar de sesión + hidratar desde DB.
  useEffect(() => {
    useChatStore.getState().clear();
    if (!id) return;
    let cancelled = false;
    companionGetChats(id)
      .then((messages) => {
        if (!cancelled) useChatStore.getState().setMessages(messages);
      })
      .catch((e) => console.warn("[SessionDashboard] hydrate chats failed", e));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Reset live state al cambiar de sesión para que el sound-trigger engine
  // no dispare reglas con datos de la sesión anterior.
  useEffect(() => {
    useLiveStateStore.getState().resetForSession();
  }, [id]);

  // Engine de sound triggers — siempre montado mientras hay sesión activa.
  // El hook subscribe al live store y dispara acciones según transiciones.
  useSoundTriggerEngine(id ?? null, Boolean(id));

  useEffect(() => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (!authenticated) return;
    const tick = () => {
      if (!document.hidden) poll();
    };
    tick();
    pollIntervalRef.current = setInterval(tick, 5000);
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [authenticated]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Global overlays — bypass the input-focus guard so podés tirar
      // dados / generar mientras escribís el guión, o buscar en manuales.
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === "r") {
          e.preventDefault();
          setDiceOpen((v) => !v);
          return;
        }
        if (key === "g") {
          e.preventDefault();
          setGeneratorOpen((v) => !v);
          return;
        }
        if (key === "k") {
          e.preventDefault();
          setManualSearchOpen((v) => !v);
          return;
        }
        if (key === "m" && companion?.running) {
          e.preventDefault();
          setHandoutOpen((v) => !v);
          return;
        }
      }

      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "\\") {
          e.preventDefault();
          setCollapsed((c) => !c);
          return;
        }
        if (e.key === "?" || e.key === "/") {
          e.preventDefault();
          setHelpOpen((v) => !v);
          return;
        }
        const num = parseInt(e.key);
        if (!isNaN(num)) {
          if (num >= 1 && num <= 3) {
            e.preventDefault();
            if (mode !== "live" || num === 1) setMainSection(MAIN_NAV[num - 1].key);
            return;
          }
          if (num >= 4 && num <= 7) {
            e.preventDefault();
            setToolTab(TOOL_TABS[num - 4].key);
            if (collapsed) setCollapsed(false);
            return;
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, collapsed, companion?.running]);

  if (!id) return null;

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim() || !session) return;
    try {
      await updateSession(session.id, editName.trim(), session.description ?? undefined);
      setEditing(false);
      toast.success("Sesión renombrada");
    } catch (err) {
      console.error("[SessionDashboard] rename failed", err);
      toast.error("No se pudo renombrar la sesión");
    }
  };

  const handleModeChange = (m: Mode) => {
    if (m === mode) return;
    if (m === "live") {
      setMainSection("guion");
      setCollapsed(false);
      toast.info("Modo Live · el guión queda en solo-lectura", 3000);
    } else {
      toast.info("Modo Prep · podés editar el guión", 1500);
    }
    setMode(m);
  };

  const cyclePanelSize = () => {
    setPanelSize((s) => (s === "sm" ? "md" : s === "md" ? "lg" : "sm"));
  };

  const activeToolMeta = TOOL_TABS.find((t) => t.key === toolTab)!;
  const panelWidth = PANEL_SIZES[panelSize];

  return (
    <div className="h-screen flex flex-col bg-parchment-950 text-vellum-50 overflow-hidden">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="border-b border-parchment-800 bg-parchment-900/70 backdrop-blur flex-shrink-0 flex items-center gap-3 px-4 py-2 h-12">
        <Tooltip content="Volver a la lista de sesiones" side="bottom">
          <button
            onClick={() => navigate("/")}
            className="text-vellum-400 hover:text-vellum-100 text-sm transition-colors flex-shrink-0 flex items-center gap-1"
          >
            <span className="text-base">‹</span>
            <span className="hidden sm:inline">Sesiones</span>
          </button>
        </Tooltip>
        <span className="text-parchment-700">|</span>

        {editing ? (
          <form onSubmit={handleRename} className="flex items-center gap-2 flex-1 min-w-0">
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="bg-parchment-800 border border-gold-600 rounded-md px-2 py-1 text-vellum-50 text-sm focus:outline-none min-w-0 flex-1 max-w-xs"
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            />
            <button
              type="submit"
              className="bg-gold-600 hover:bg-gold-500 text-parchment-950 px-3 py-1 rounded-md text-sm font-medium transition-colors flex-shrink-0"
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-vellum-400 hover:text-vellum-200 text-sm transition-colors flex-shrink-0"
            >
              Cancelar
            </button>
          </form>
        ) : (
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <Tooltip content="Click para renombrar la sesión" side="bottom">
              <h1
                className="font-display text-gold-400 cursor-pointer hover:text-gold-300 transition-colors truncate text-base font-semibold min-w-0"
                onClick={() => setEditing(true)}
              >
                {session?.name ?? "Cargando..."}
              </h1>
            </Tooltip>
            {session?.description && (
              <span className="text-vellum-400 text-sm truncate hidden lg:block min-w-0">
                — {session.description}
              </span>
            )}
          </div>
        )}

        {/* Mode toggle. En pantallas chicas se reduce a iconos para no ocupar
            espacio del header. */}
        <div className="ml-auto flex-shrink-0 flex bg-parchment-800 rounded-lg p-0.5 gap-0.5">
          <Tooltip content="Modo edición — escribís el guión y configurás cues" side="bottom">
            <button
              onClick={() => handleModeChange("prep")}
              className={`px-2 sm:px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                mode === "prep"
                  ? "bg-parchment-600 text-vellum-50"
                  : "text-vellum-300 hover:text-vellum-100"
              }`}
            >
              ✏️<span className="hidden sm:inline"> Prep</span>
            </button>
          </Tooltip>
          <Tooltip content="Modo sesión — disparás cues mientras narrás" side="bottom">
            <button
              onClick={() => handleModeChange("live")}
              className={`px-2 sm:px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                mode === "live" ? "bg-gold-600 text-parchment-950" : "text-vellum-300 hover:text-vellum-100"
              }`}
            >
              ▶<span className="hidden sm:inline"> Live</span>
            </button>
          </Tooltip>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          <Tooltip
            content={
              companion?.running
                ? `Companion activo · ${companion.connected.length} conectado${
                    companion.connected.length === 1 ? "" : "s"
                  }`
                : "Compartir con jugadores via celu"
            }
            side="bottom"
          >
            <button
              onClick={() => setCompanionOpen(true)}
              className={`relative flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors ${
                companion?.running
                  ? "bg-success-900/40 text-success-300 hover:bg-success-900/60"
                  : "text-vellum-300 hover:text-vellum-100 hover:bg-parchment-800"
              }`}
              aria-label="Companion para jugadores"
            >
              <span aria-hidden>📡</span>
              {companion?.running ? (
                <span className="font-medium tabular-nums">
                  {companion.connected.length}
                </span>
              ) : (
                <span className="hidden sm:inline">Compartir</span>
              )}
              {companion?.running && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-success-500 animate-pulse" />
              )}
            </button>
          </Tooltip>

          {/* Chat button — solo aparece con companion activo (regla
              anti-saturación: si no hay players, el feature no existe). */}
          {companion?.running && (
            <ChatHeaderButton
              onClick={() => setChatOpen((v) => !v)}
              isOpen={chatOpen}
            />
          )}

          <IconButton
            label="Atajos de teclado y sintaxis de cues"
            shortcut="Ctrl+?"
            size="sm"
            onClick={() => setHelpOpen(true)}
          >
            ?
          </IconButton>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left sidebar — labelled main nav */}
        <nav
          className="w-20 flex-shrink-0 border-r border-parchment-800 bg-parchment-900/40 flex flex-col items-stretch py-2 gap-1 px-1"
          aria-label="Secciones principales"
        >
          {MAIN_NAV.map(({ key, icon, label, shortcut }) => {
            const isLive = mode === "live";
            const disabled = isLive && key !== "guion";
            const active = mainSection === key && !disabled;
            return (
              <Tooltip key={key} content={label} shortcut={shortcut} side="right">
                <button
                  onClick={() => !disabled && setMainSection(key)}
                  disabled={disabled}
                  className={`flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg transition-colors w-full ${
                    active
                      ? "bg-parchment-700 text-gold-300"
                      : disabled
                      ? "text-parchment-600 cursor-not-allowed opacity-50"
                      : "text-vellum-300 hover:text-vellum-50 hover:bg-parchment-800"
                  }`}
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="text-lg leading-none" aria-hidden>
                    {icon}
                  </span>
                  <span className="text-[10px] font-medium leading-tight">{label}</span>
                </button>
              </Tooltip>
            );
          })}
        </nav>

        {/* Main workspace */}
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
          <div className={mainSection === "guion" ? "h-full" : "hidden"}>
            <GuionEditor sessionId={id} mode={mode} />
          </div>
          <div className={mainSection === "assets" ? "h-full" : "hidden"}>
            <LibraryBrowser sessionId={id} />
          </div>
          <div className={mainSection === "personajes" ? "h-full" : "hidden"}>
            <CharacterSheets sessionId={id} />
          </div>
        </div>

        {/* Right inspector */}
        <aside
          className="flex flex-shrink-0 border-l border-parchment-800"
          aria-label="Herramientas"
        >
          {/* Collapse handle */}
          <div className="flex flex-col flex-shrink-0 bg-parchment-900/40 border-r border-parchment-800">
            <Tooltip
              content={collapsed ? "Expandir panel" : "Colapsar panel"}
              shortcut="Ctrl+\\"
              side="left"
            >
              <button
                onClick={() => setCollapsed((c) => !c)}
                className="w-5 h-full hover:bg-parchment-800 text-vellum-400 hover:text-vellum-100 transition-colors text-xs flex items-center justify-center"
                aria-label={collapsed ? "Expandir panel" : "Colapsar panel"}
              >
                {collapsed ? "‹" : "›"}
              </button>
            </Tooltip>
          </div>

          {/* Inspector content */}
          <div
            className={`flex flex-col bg-parchment-900/50 transition-[width] duration-200 overflow-hidden ${
              collapsed ? "w-0" : ""
            }`}
            style={collapsed ? undefined : { width: panelWidth }}
          >
            {/* Inspector header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-parchment-800 flex-shrink-0 h-10">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-base" aria-hidden>
                  {activeToolMeta.icon}
                </span>
                <span className="font-display text-sm text-vellum-100 truncate">
                  {activeToolMeta.label}
                </span>
              </div>
              <Tooltip
                content={`Tamaño del panel — ${panelSize === "sm" ? "compacto" : panelSize === "md" ? "medio" : "amplio"}`}
                side="left"
              >
                <button
                  onClick={cyclePanelSize}
                  className="text-vellum-400 hover:text-vellum-100 text-xs px-1.5 py-0.5 rounded hover:bg-parchment-800 transition-colors flex items-center gap-1"
                  aria-label="Cambiar tamaño del panel"
                >
                  <span className="font-mono text-[10px]">{panelSize.toUpperCase()}</span>
                  <span aria-hidden>⇄</span>
                </button>
              </Tooltip>
            </div>

            {/* Tab strip — icons with tooltips */}
            <div className="flex items-center border-b border-parchment-800 flex-shrink-0">
              {TOOL_TABS.map(({ key, icon, label, shortcut }) => (
                <Tooltip key={key} content={label} shortcut={shortcut} side="bottom">
                  <button
                    onClick={() => setToolTab(key)}
                    className={`flex-1 py-2.5 text-base font-medium transition-colors border-b-2 ${
                      toolTab === key
                        ? "border-gold-500 text-gold-400 bg-parchment-900/40"
                        : "border-transparent text-vellum-400 hover:text-vellum-100"
                    }`}
                    aria-label={label}
                    aria-current={toolTab === key ? "page" : undefined}
                  >
                    {icon}
                  </button>
                </Tooltip>
              ))}
            </div>

            {/* Tool content — all always mounted */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <div className={toolTab === "soundboard" ? "h-full" : "hidden"}>
                <SoundboardPanel sessionId={id} compact />
              </div>
              <div className={toolTab === "display" ? "h-full" : "hidden"}>
                <DisplayPanel sessionId={id} />
              </div>
              <div className={toolTab === "initiative" ? "h-full" : "hidden"}>
                <InitiativeTracker sessionId={id} />
              </div>
              <div className={toolTab === "notes" ? "h-full" : "hidden"}>
                <NotesPanel sessionId={id} compact />
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Mini Spotify player — always visible, handles its own auth state */}
      <MiniSpotifyPlayer />

      {/* Help modal */}
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <DiceOverlay open={diceOpen} onClose={() => setDiceOpen(false)} />
      <GeneratorOverlay
        open={generatorOpen}
        sessionId={id}
        onClose={() => setGeneratorOpen(false)}
      />
      <ManualSearch open={manualSearchOpen} onClose={() => setManualSearchOpen(false)} />
      <CompanionDialog
        open={companionOpen}
        sessionId={id}
        campaignName={session?.name ?? "Sesión D&D"}
        onClose={() => setCompanionOpen(false)}
        onStatusChange={setCompanion}
      />
      <SendHandoutDialog open={handoutOpen} onClose={() => setHandoutOpen(false)} />
      <ChatPanel
        open={chatOpen && Boolean(companion?.running)}
        sessionId={id}
        connectedPlayers={companion?.connected ?? []}
        onClose={() => setChatOpen(false)}
      />
    </div>
  );
}

// ── ChatHeaderButton ─────────────────────────────────────────────────────────
//
// Wrapper chico para el botón del header. Subscribe al chatStore para mostrar
// el badge de unread sin re-renderizar el dashboard entero en cada mensaje.
// Lee `threads` y `lastRead` para sumar mensajes nuevos en TODOS los threads.

function ChatHeaderButton({ onClick, isOpen }: { onClick: () => void; isOpen: boolean }) {
  const totalUnread = useChatStore((s) => {
    let total = 0;
    for (const key of Object.keys(s.threads)) {
      const messages = s.threads[key];
      total += unreadCount(messages, s.lastRead[key]);
    }
    return total;
  });

  return (
    <Tooltip
      content={
        totalUnread > 0
          ? `Chat · ${totalUnread} mensaje${totalUnread === 1 ? "" : "s"} sin leer`
          : "Chat de mesa (DM ve todo)"
      }
      side="bottom"
    >
      <button
        onClick={onClick}
        className={`relative flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors ${
          isOpen
            ? "bg-gold-700/40 text-gold-200"
            : "text-vellum-300 hover:text-vellum-100 hover:bg-parchment-800"
        }`}
        aria-label="Chat de mesa"
      >
        <span aria-hidden>💬</span>
        {totalUnread > 0 && (
          <span className="bg-gold-500 text-parchment-950 text-[10px] rounded-full px-1.5 font-medium tabular-nums">
            {totalUnread}
          </span>
        )}
      </button>
    </Tooltip>
  );
}


import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSessionStore } from "../store/sessionStore";
import { useSpotifyStore } from "../store/spotifyStore";
import AssetBrowser from "../components/AssetBrowser";
import NotesPanel from "../components/NotesPanel";
import SoundboardPanel from "../components/SoundboardPanel";
import DisplayPanel from "../components/DisplayPanel";
import GuionEditor from "../components/GuionEditor";
import InitiativeTracker from "../components/InitiativeTracker";
import MiniSpotifyPlayer from "../components/MiniSpotifyPlayer";
import CharacterSheets from "../components/CharacterSheets";
import HelpModal from "../components/HelpModal";
import type { Session } from "../lib/types";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "../lib/toast";
import { IconButton, Tooltip } from "../components/ui";

type MainSection = "guion" | "assets" | "personajes";
type ToolTab = "soundboard" | "display" | "initiative" | "notes";
type Mode = "prep" | "live";
type PanelSize = "sm" | "md" | "lg";

const PANEL_SIZES: Record<PanelSize, number> = { sm: 320, md: 400, lg: 480 };
const LS_KEY = "dnd-dashboard-v2";

function loadPrefs() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function savePrefs(patch: Record<string, unknown>) {
  try {
    const prev = loadPrefs();
    localStorage.setItem(LS_KEY, JSON.stringify({ ...prev, ...patch }));
  } catch {
    /* ignore */
  }
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
  }, [mode, collapsed]);

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
            <span className="text-base">‹</span> Sesiones
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
          <Tooltip content="Click para renombrar la sesión" side="bottom">
            <h1
              className="font-display text-gold-400 cursor-pointer hover:text-gold-300 transition-colors truncate text-base font-semibold"
              onClick={() => setEditing(true)}
            >
              {session?.name ?? "Cargando..."}
            </h1>
          </Tooltip>
        )}

        {session?.description && !editing && (
          <span className="text-vellum-400 text-sm truncate hidden md:block flex-shrink-0">
            — {session.description}
          </span>
        )}

        {/* Mode toggle */}
        <div className="ml-auto flex-shrink-0 flex bg-parchment-800 rounded-lg p-0.5 gap-0.5">
          <Tooltip content="Modo edición — escribís el guión y configurás cues" side="bottom">
            <button
              onClick={() => handleModeChange("prep")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                mode === "prep"
                  ? "bg-parchment-600 text-vellum-50"
                  : "text-vellum-300 hover:text-vellum-100"
              }`}
            >
              ✏️ Prep
            </button>
          </Tooltip>
          <Tooltip content="Modo sesión — disparás cues mientras narrás" side="bottom">
            <button
              onClick={() => handleModeChange("live")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                mode === "live" ? "bg-gold-600 text-parchment-950" : "text-vellum-300 hover:text-vellum-100"
              }`}
            >
              ▶ Live
            </button>
          </Tooltip>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
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
            <AssetBrowser sessionId={id} />
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
                <DisplayPanel sessionId={id} compact />
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
    </div>
  );
}

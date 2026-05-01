import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSessionStore } from "../store/sessionStore";
import { useSpotifyStore } from "../store/spotifyStore";
import AssetBrowser from "../components/AssetBrowser";
import NotesPanel from "../components/NotesPanel";
import SoundboardPanel from "../components/SoundboardPanel";
import DisplayPanel from "../components/DisplayPanel";
import GuionEditor from "../components/GuionEditor";
import InitiativeTracker from "../components/InitiativeTracker";
import SpotifyPanel from "../components/SpotifyPanel";
import MiniSpotifyPlayer from "../components/MiniSpotifyPlayer";
import CharacterSheets from "../components/CharacterSheets";
import type { Session } from "../lib/types";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "../lib/toast";

type MainSection = "guion" | "assets" | "personajes";
type ToolTab = "soundboard" | "display" | "initiative" | "notes" | "spotify";
type Mode = "prep" | "live";

const PANEL_MIN = 240;
const PANEL_MAX = 560;
const PANEL_DEFAULT = 320;
const LS_KEY = "dnd-dashboard-v1";

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
  } catch { /* ignore */ }
}

export default function SessionDashboard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { sessions, fetchSessions, updateSession } = useSessionStore();
  const { authenticated, setAuthenticated, poll } = useSpotifyStore();
  const [session, setSession] = useState<Session | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");

  // ── Persisted UI state ──────────────────────────────────────────────────
  const prefs = loadPrefs();
  const [mainSection, setMainSection] = useState<MainSection>(
    (prefs.mainSection as MainSection) ?? "guion"
  );
  const [toolTab, setToolTab] = useState<ToolTab>(
    (prefs.toolTab as ToolTab) ?? "soundboard"
  );
  const [collapsed, setCollapsed] = useState<boolean>(
    (prefs.collapsed as boolean) ?? false
  );
  const [panelWidth, setPanelWidth] = useState<number>(
    (prefs.panelWidth as number) ?? PANEL_DEFAULT
  );
  const [mode, setMode] = useState<Mode>("prep");

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragStateRef = useRef<{ startX: number; startW: number } | null>(null);

  // ── Persist prefs ───────────────────────────────────────────────────────
  useEffect(() => { savePrefs({ mainSection }); }, [mainSection]);
  useEffect(() => { savePrefs({ toolTab }); }, [toolTab]);
  useEffect(() => { savePrefs({ collapsed }); }, [collapsed]);
  useEffect(() => { savePrefs({ panelWidth }); }, [panelWidth]);

  // ── Data loading ────────────────────────────────────────────────────────
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
    poll();
    pollIntervalRef.current = setInterval(poll, 3000);
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [authenticated]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  const mainNavKeys: MainSection[] = ["guion", "assets", "personajes"];
  const toolTabKeys: ToolTab[] = ["soundboard", "display", "initiative", "notes", "spotify"];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) return;

      if (e.ctrlKey || e.metaKey) {
        // Ctrl+\ → toggle panel
        if (e.key === "\\") {
          e.preventDefault();
          setCollapsed((c) => !c);
          return;
        }
        const num = parseInt(e.key);
        if (!isNaN(num)) {
          // Ctrl+1/2/3 → main sections
          if (num >= 1 && num <= 3) {
            e.preventDefault();
            if (mode !== "live" || num === 1) {
              setMainSection(mainNavKeys[num - 1]);
            }
            return;
          }
          // Ctrl+4..8 → tool tabs
          if (num >= 4 && num <= 8) {
            e.preventDefault();
            setToolTab(toolTabKeys[num - 4]);
            if (collapsed) setCollapsed(false);
            return;
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, collapsed]);

  // ── Resize handle ───────────────────────────────────────────────────────
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStateRef.current = { startX: e.clientX, startW: panelWidth };

    const onMove = (ev: MouseEvent) => {
      if (!dragStateRef.current) return;
      const delta = dragStateRef.current.startX - ev.clientX; // dragging left = wider
      const newW = Math.min(PANEL_MAX, Math.max(PANEL_MIN, dragStateRef.current.startW + delta));
      setPanelWidth(newW);
    };

    const onUp = () => {
      dragStateRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [panelWidth]);

  if (!id) return null;

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim() || !session) return;
    try {
      await updateSession(session.id, editName.trim(), session.description ?? undefined);
      setEditing(false);
      toast.success("Sesión renombrada");
    } catch (e) {
      console.error("[SessionDashboard] rename failed", e);
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

  const mainNavItems: { key: MainSection; icon: string; label: string; shortcut: string }[] = [
    { key: "guion",      icon: "📜", label: "Guión",      shortcut: "Ctrl+1" },
    { key: "assets",     icon: "🗃",  label: "Assets",     shortcut: "Ctrl+2" },
    { key: "personajes", icon: "👤", label: "Personajes",  shortcut: "Ctrl+3" },
  ];

  const toolItems: { key: ToolTab; icon: string; label: string; shortcut: string }[] = [
    { key: "soundboard", icon: "🔊", label: "Sonido",      shortcut: "Ctrl+4" },
    { key: "display",    icon: "🖥",  label: "Proyección",  shortcut: "Ctrl+5" },
    { key: "initiative", icon: "⚔",  label: "Iniciativa",  shortcut: "Ctrl+6" },
    { key: "notes",      icon: "📝", label: "Notas",       shortcut: "Ctrl+7" },
    { key: "spotify",    icon: "🎵", label: "Spotify",     shortcut: "Ctrl+8" },
  ];

  return (
    <div className="h-screen flex flex-col bg-stone-950 text-stone-100 overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="border-b border-stone-800 bg-stone-900/60 flex-shrink-0 flex items-center gap-3 px-4 py-2.5 h-12">
        <button
          onClick={() => navigate("/")}
          className="text-stone-400 hover:text-stone-200 text-sm transition-colors flex-shrink-0"
        >
          ‹ Sesiones
        </button>
        <span className="text-stone-700">|</span>

        {editing ? (
          <form onSubmit={handleRename} className="flex items-center gap-2 flex-1 min-w-0">
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="bg-stone-800 border border-amber-600 rounded px-2 py-1 text-stone-100 text-sm focus:outline-none min-w-0 flex-1 max-w-xs"
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
            />
            <button type="submit" className="bg-amber-700 hover:bg-amber-600 text-white px-3 py-1 rounded text-sm transition-colors flex-shrink-0">
              Guardar
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-stone-500 hover:text-stone-300 text-sm transition-colors flex-shrink-0">
              Cancelar
            </button>
          </form>
        ) : (
          <h1
            className="text-amber-400 cursor-pointer hover:text-amber-300 transition-colors truncate"
            style={{ fontFamily: "var(--font-family-display)", fontSize: "1rem", fontWeight: 600 }}
            title="Click para renombrar"
            onClick={() => setEditing(true)}
          >
            {session?.name ?? "Cargando..."}
          </h1>
        )}

        {session?.description && !editing && (
          <span className="text-stone-500 text-sm truncate hidden md:block flex-shrink-0">
            — {session.description}
          </span>
        )}

        {/* Mode toggle */}
        <div className="ml-auto flex-shrink-0 flex bg-stone-800 rounded-lg p-0.5 gap-0.5">
          <button
            onClick={() => handleModeChange("prep")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              mode === "prep"
                ? "bg-stone-600 text-stone-100"
                : "text-stone-400 hover:text-stone-200"
            }`}
          >
            ✏️ Prep
          </button>
          <button
            onClick={() => handleModeChange("live")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              mode === "live"
                ? "bg-amber-700 text-white"
                : "text-stone-400 hover:text-stone-200"
            }`}
          >
            ▶ Live
          </button>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left nav (48px) */}
        <div className="w-12 flex-shrink-0 border-r border-stone-800 bg-stone-900/40 flex flex-col items-center py-2 gap-1">
          {mainNavItems.map(({ key, icon, label, shortcut }) => {
            const isLive = mode === "live";
            const disabled = isLive && key !== "guion";
            return (
              <button
                key={key}
                onClick={() => !disabled && setMainSection(key)}
                title={`${label} (${shortcut})`}
                className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-colors ${
                  mainSection === key && !disabled
                    ? "bg-stone-700 text-stone-100"
                    : disabled
                    ? "text-stone-700 cursor-not-allowed opacity-40"
                    : "text-stone-500 hover:text-stone-200 hover:bg-stone-800"
                }`}
              >
                {icon}
              </button>
            );
          })}
        </div>

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

        {/* Tool panel + resize handle + collapse toggle */}
        <div className="flex flex-shrink-0">
          {/* Resize + collapse strip */}
          <div className="flex flex-col border-l border-stone-800 flex-shrink-0">
            {/* Drag handle (top portion) */}
            <div
              onMouseDown={onResizeMouseDown}
              className="flex-1 w-4 cursor-col-resize hover:bg-stone-700/50 transition-colors group flex items-center justify-center"
              title="Arrastrá para redimensionar"
            >
              <div className="w-0.5 h-8 bg-stone-700 rounded-full group-hover:bg-stone-500 transition-colors" />
            </div>
            {/* Collapse button (bottom) */}
            <button
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? "Expandir panel (Ctrl+\\)" : "Colapsar panel (Ctrl+\\)"}
              className="w-4 h-8 flex-shrink-0 flex items-center justify-center bg-stone-900/40 hover:bg-stone-800 text-stone-600 hover:text-stone-300 transition-colors text-xs mb-2"
            >
              {collapsed ? "‹" : "›"}
            </button>
          </div>

          {/* Tool panel */}
          <div
            className={`flex flex-col bg-stone-900/30 transition-[width] duration-200 overflow-hidden border-l border-stone-800 ${
              collapsed ? "w-0" : ""
            }`}
            style={collapsed ? undefined : { width: panelWidth }}
          >
            {/* Tab strip */}
            <div className="flex items-center border-b border-stone-800 flex-shrink-0">
              {toolItems.map(({ key, icon, label, shortcut }) => (
                <button
                  key={key}
                  onClick={() => setToolTab(key)}
                  title={`${label} (${shortcut})`}
                  className={`flex-1 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                    toolTab === key
                      ? "border-amber-500 text-amber-400"
                      : "border-transparent text-stone-500 hover:text-stone-300"
                  }`}
                >
                  {icon}
                </button>
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
              <div className={toolTab === "spotify" ? "h-full" : "hidden"}>
                <SpotifyPanel compact />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mini Spotify player */}
      {authenticated && <MiniSpotifyPlayer />}
    </div>
  );
}

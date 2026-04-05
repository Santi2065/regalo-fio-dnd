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
import SpotifyPanel from "../components/SpotifyPanel";
import MiniSpotifyPlayer from "../components/MiniSpotifyPlayer";
import CharacterSheets from "../components/CharacterSheets";
import type { Session } from "../lib/types";
import { invoke } from "@tauri-apps/api/core";

type MainSection = "guion" | "assets" | "personajes";
type ToolTab = "soundboard" | "display" | "initiative" | "notes" | "spotify";
type Mode = "prep" | "live";

export default function SessionDashboard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { sessions, fetchSessions, updateSession } = useSessionStore();
  const { authenticated, setAuthenticated, poll } = useSpotifyStore();
  const [session, setSession] = useState<Session | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");

  const [mainSection, setMainSection] = useState<MainSection>("guion");
  const [toolTab, setToolTab] = useState<ToolTab>("soundboard");
  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState<Mode>("prep");

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  if (!id) return null;

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim() || !session) return;
    await updateSession(session.id, editName.trim(), session.description ?? undefined);
    setEditing(false);
  };

  const handleModeChange = (m: Mode) => {
    if (m === "live") {
      // Force guion section and expand tool panel in live mode
      setMainSection("guion");
      setCollapsed(false);
    }
    setMode(m);
  };

  const mainNavItems: { key: MainSection; icon: string; label: string }[] = [
    { key: "guion",     icon: "📜", label: "Guión" },
    { key: "assets",    icon: "🗃",  label: "Assets" },
    { key: "personajes",icon: "👤", label: "Personajes" },
  ];

  const toolItems: { key: ToolTab; icon: string; label: string }[] = [
    { key: "soundboard", icon: "🔊", label: "Sonido" },
    { key: "display",    icon: "🖥",  label: "Proyección" },
    { key: "initiative", icon: "⚔",  label: "Iniciativa" },
    { key: "notes",      icon: "📝", label: "Notas" },
    { key: "spotify",    icon: "🎵", label: "Spotify" },
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
            className="font-semibold text-amber-400 text-base cursor-pointer hover:text-amber-300 transition-colors truncate"
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

      {/* ── Body: left nav + main workspace + tool panel ─────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left nav (48px) */}
        <div className="w-12 flex-shrink-0 border-r border-stone-800 bg-stone-900/40 flex flex-col items-center py-2 gap-1">
          {mainNavItems.map(({ key, icon, label }) => {
            const isLive = mode === "live";
            const disabled = isLive && key !== "guion";
            return (
              <button
                key={key}
                onClick={() => !disabled && setMainSection(key)}
                title={label}
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

        {/* Main workspace — all sections always mounted */}
        <div className="flex-1 min-w-0 min-h-0 relative overflow-hidden">
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

        {/* Tool panel + collapse toggle */}
        <div className="flex flex-shrink-0">
          {/* Collapse toggle button — always visible at the seam */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expandir panel" : "Colapsar panel"}
            className="w-4 flex-shrink-0 flex items-center justify-center bg-stone-900/40 hover:bg-stone-800 border-l border-stone-800 text-stone-600 hover:text-stone-300 transition-colors text-xs self-stretch"
          >
            {collapsed ? "‹" : "›"}
          </button>

          {/* Tool panel (320px, collapsible) */}
          <div
            className={`flex flex-col bg-stone-900/30 transition-all duration-200 overflow-hidden border-l border-stone-800 ${
              collapsed ? "w-0" : "w-80"
            }`}
          >
            {/* Tab strip */}
            <div className="flex items-center border-b border-stone-800 flex-shrink-0">
              {toolItems.map(({ key, icon, label }) => (
                <button
                  key={key}
                  onClick={() => setToolTab(key)}
                  title={label}
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
                <InitiativeTracker />
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

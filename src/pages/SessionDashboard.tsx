import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSessionStore } from "../store/sessionStore";
import AssetBrowser from "../components/AssetBrowser";
import NotesPanel from "../components/NotesPanel";
import SoundboardPanel from "../components/SoundboardPanel";
import DisplayPanel from "../components/DisplayPanel";
import GuionEditor from "../components/GuionEditor";
import type { Session } from "../lib/types";

type Tab = "guion" | "assets" | "notes" | "soundboard" | "display";

export default function SessionDashboard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { sessions, fetchSessions, updateSession } = useSessionStore();
  const [session, setSession] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("guion");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");

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

  if (!id) return null;

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim() || !session) return;
    await updateSession(session.id, editName.trim(), session.description ?? undefined);
    setEditing(false);
  };

  const tabs: { key: Tab; label: string; icon: string; hint?: string }[] = [
    { key: "guion",      label: "Guión",      icon: "📜", hint: "El eje de la sesión" },
    { key: "assets",     label: "Assets",     icon: "🗃" },
    { key: "notes",      label: "Notas",      icon: "📝" },
    { key: "soundboard", label: "Soundboard", icon: "🎵" },
    { key: "display",    label: "Proyección", icon: "🖥" },
  ];

  return (
    <div className="h-screen flex flex-col bg-stone-950 text-stone-100">
      {/* Header */}
      <div className="border-b border-stone-800 bg-stone-900/60 flex-shrink-0">
        <div className="px-6 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="text-stone-400 hover:text-stone-200 text-sm transition-colors"
          >
            ‹ Sesiones
          </button>
          <span className="text-stone-700">|</span>

          {editing ? (
            <form onSubmit={handleRename} className="flex items-center gap-2 flex-1">
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="bg-stone-800 border border-amber-600 rounded px-2 py-1 text-stone-100 text-sm focus:outline-none min-w-0 flex-1 max-w-xs"
                onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
              />
              <button type="submit" className="bg-amber-700 hover:bg-amber-600 text-white px-3 py-1 rounded text-sm transition-colors">
                Guardar
              </button>
              <button type="button" onClick={() => setEditing(false)} className="text-stone-500 hover:text-stone-300 text-sm transition-colors">
                Cancelar
              </button>
            </form>
          ) : (
            <h1
              className="font-semibold text-amber-400 text-base cursor-pointer hover:text-amber-300 transition-colors"
              title="Click para renombrar"
              onClick={() => setEditing(true)}
            >
              {session?.name ?? "Cargando..."}
            </h1>
          )}

          {session?.description && !editing && (
            <span className="text-stone-500 text-sm truncate hidden md:block">
              — {session.description}
            </span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex px-6 gap-1 border-t border-stone-800/50">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              title={tab.hint}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.key
                  ? "border-amber-500 text-amber-400"
                  : "border-transparent text-stone-400 hover:text-stone-200"
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "guion"      && <GuionEditor sessionId={id} />}
        {activeTab === "assets"     && <AssetBrowser sessionId={id} />}
        {activeTab === "notes"      && <NotesPanel sessionId={id} />}
        {activeTab === "soundboard" && <SoundboardPanel sessionId={id} />}
        {activeTab === "display"    && <DisplayPanel sessionId={id} />}
      </div>
    </div>
  );
}

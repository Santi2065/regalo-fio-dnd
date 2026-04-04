import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionStore } from "../store/sessionStore";

export default function SessionList() {
  const navigate = useNavigate();
  const { sessions, loading, fetchSessions, createSession, deleteSession } = useSessionStore();
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    fetchSessions();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const session = await createSession(newName.trim(), newDesc.trim() || undefined);
      setNewName("");
      setNewDesc("");
      setShowNew(false);
      navigate(`/session/${session.id}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteSession(id);
    setDeleteConfirm(null);
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString("es-AR", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      {/* Header */}
      <div className="border-b border-stone-800 bg-stone-900/50">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-amber-400 tracking-wide">⚔ DnD Orchestrator</h1>
            <p className="text-stone-400 text-sm mt-0.5">El cuartel general del Dungeon Master</p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="bg-amber-700 hover:bg-amber-600 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm"
          >
            + Nueva Sesión
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* New session form */}
        {showNew && (
          <div className="mb-8 bg-stone-900 border border-stone-700 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-stone-100 mb-4">Nueva Sesión</h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-sm text-stone-400 mb-1">Nombre *</label>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="ej: Juntada 1 - La Taberna del Dragón"
                  className="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-2 text-stone-100 placeholder-stone-500 focus:outline-none focus:border-amber-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-stone-400 mb-1">Descripción (opcional)</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Notas sobre esta sesión..."
                  rows={2}
                  className="w-full bg-stone-800 border border-stone-600 rounded-lg px-3 py-2 text-stone-100 placeholder-stone-500 focus:outline-none focus:border-amber-500 text-sm resize-none"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={!newName.trim() || creating}
                  className="bg-amber-700 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  {creating ? "Creando..." : "Crear Sesión"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowNew(false); setNewName(""); setNewDesc(""); }}
                  className="bg-stone-700 hover:bg-stone-600 text-stone-300 px-4 py-2 rounded-lg text-sm transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Sessions list */}
        {loading ? (
          <div className="text-center text-stone-500 py-16">Cargando...</div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">🗺</div>
            <h2 className="text-xl font-semibold text-stone-400 mb-2">Sin sesiones todavía</h2>
            <p className="text-stone-500 text-sm">Crea tu primera sesión para empezar a organizar.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="group bg-stone-900 border border-stone-700 hover:border-stone-500 rounded-xl p-5 flex items-center justify-between transition-colors cursor-pointer"
                onClick={() => navigate(`/session/${session.id}`)}
              >
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-stone-100 text-base truncate">{session.name}</h3>
                  {session.description && (
                    <p className="text-stone-400 text-sm mt-0.5 truncate">{session.description}</p>
                  )}
                  <p className="text-stone-600 text-xs mt-1">
                    Actualizada {formatDate(session.updated_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(session.id); }}
                    className="text-stone-500 hover:text-red-400 p-2 rounded-lg hover:bg-stone-800 transition-colors text-sm"
                    title="Eliminar sesión"
                  >
                    🗑
                  </button>
                  <span className="text-stone-600 text-lg">›</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-stone-900 border border-stone-700 rounded-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-stone-100 mb-2">¿Eliminar sesión?</h3>
            <p className="text-stone-400 text-sm mb-4">
              Se eliminarán todos los assets, notas y configuraciones de esta sesión. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 bg-red-800 hover:bg-red-700 text-white py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Eliminar
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 bg-stone-700 hover:bg-stone-600 text-stone-300 py-2 rounded-lg text-sm transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

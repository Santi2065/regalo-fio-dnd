import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionStore } from "../store/sessionStore";
import { toast } from "../lib/toast";
import { Button, Card, EmptyState, ConfirmDialog, IconButton } from "../components/ui";

export default function SessionList() {
  const navigate = useNavigate();
  const { sessions, loading, fetchSessions, createSession, deleteSession } = useSessionStore();
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    } catch (e) {
      console.error("[SessionList] create failed", e);
      toast.error("No se pudo crear la sesión");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await deleteSession(id);
      setDeleteConfirm(null);
      toast.success("Sesión eliminada");
    } catch (e) {
      console.error("[SessionList] delete failed", e);
      toast.error("No se pudo eliminar la sesión");
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("es-AR", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  return (
    <div className="min-h-screen bg-parchment-950 text-vellum-50">
      {/* Header */}
      <div className="border-b border-parchment-800 bg-parchment-900/60 backdrop-blur">
        <div className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold text-gold-400 tracking-wide leading-tight">
              <span className="text-gold-300 mr-1">⚔</span> DnD Orchestrator
            </h1>
            <p className="text-vellum-300 text-sm mt-1">
              El cuartel general del Dungeon Master
            </p>
          </div>
          <Button variant="primary" size="md" onClick={() => setShowNew(true)} iconBefore="+">
            Nueva Sesión
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* New session form */}
        {showNew && (
          <Card raised padding="lg" className="mb-8">
            <h2 className="font-display text-xl text-vellum-50 mb-4">Nueva Sesión</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm text-vellum-300 mb-1.5">
                  Nombre <span className="text-danger-300">*</span>
                </label>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="ej: Juntada 1 — La Taberna del Dragón"
                  className="w-full bg-parchment-800 border border-parchment-700 rounded-md px-3 py-2 text-vellum-50 placeholder-vellum-400 focus:outline-none focus:border-gold-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-vellum-300 mb-1.5">
                  Descripción <span className="text-vellum-400">(opcional)</span>
                </label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Notas sobre esta sesión..."
                  rows={2}
                  className="w-full bg-parchment-800 border border-parchment-700 rounded-md px-3 py-2 text-vellum-50 placeholder-vellum-400 focus:outline-none focus:border-gold-500 text-sm resize-none"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!newName.trim()}
                  loading={creating}
                >
                  {creating ? "Creando..." : "Crear Sesión"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowNew(false);
                    setNewName("");
                    setNewDesc("");
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Sessions list */}
        {loading ? (
          <div className="text-center text-vellum-400 py-16">Cargando...</div>
        ) : sessions.length === 0 ? (
          <EmptyState
            size="lg"
            icon="🗺"
            title="Aún no hay sesiones"
            description="Crea tu primera sesión para empezar a organizar el juego."
            action={
              <Button variant="primary" onClick={() => setShowNew(true)} iconBefore="+">
                Nueva Sesión
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3">
            {sessions.map((session) => (
              <Card
                key={session.id}
                interactive
                padding="md"
                onClick={() => navigate(`/session/${session.id}`)}
                className="group flex items-center justify-between"
              >
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-vellum-50 text-base truncate leading-tight">
                    {session.name}
                  </h3>
                  {session.description && (
                    <p className="text-vellum-300 text-sm mt-0.5 truncate">
                      {session.description}
                    </p>
                  )}
                  <p className="text-vellum-400 text-xs mt-1">
                    Actualizada {formatDate(session.updated_at)}
                  </p>
                </div>
                <div className="flex items-center gap-1 ml-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <IconButton
                    label="Eliminar sesión"
                    variant="danger"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirm(session.id);
                    }}
                  >
                    🗑
                  </IconButton>
                  <span className="text-vellum-400 text-lg pl-1">›</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteConfirm}
        title="¿Eliminar sesión?"
        description="Se eliminarán todos los assets, notas y configuraciones de esta sesión. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        danger
        loading={deleting}
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
      />
    </div>
  );
}

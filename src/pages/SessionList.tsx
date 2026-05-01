import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionStore } from "../store/sessionStore";
import { toast } from "../lib/toast";
import { Button, Card, ConfirmDialog, IconButton, Skeleton, Tooltip } from "../components/ui";

export default function SessionList() {
  const navigate = useNavigate();
  const { sessions, loading, fetchSessions, createSession, createSampleSession, deleteSession } =
    useSessionStore();
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [creatingSample, setCreatingSample] = useState(false);
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

  const handleSample = async () => {
    setCreatingSample(true);
    try {
      const session = await createSampleSession();
      toast.success("Sesión de ejemplo cargada — abriendo...");
      navigate(`/session/${session.id}`);
    } catch (e) {
      console.error("[SessionList] sample failed", e);
      toast.error("No se pudo cargar la sesión de ejemplo");
    } finally {
      setCreatingSample(false);
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
          <div className="flex items-center gap-2">
            <Tooltip content="Cargá una sesión pre-armada para ver cómo funciona todo" side="bottom">
              <Button
                variant="ghost"
                size="md"
                onClick={handleSample}
                loading={creatingSample}
                iconBefore="✨"
              >
                Sesión de ejemplo
              </Button>
            </Tooltip>
            <Button variant="primary" size="md" onClick={() => setShowNew(true)} iconBefore="+">
              Nueva Sesión
            </Button>
          </div>
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
          <div className="grid gap-3" aria-label="Cargando sesiones">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} padding="md" className="flex items-center justify-between">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-2.5 w-24 mt-1" />
                </div>
                <Skeleton className="h-5 w-5 ml-4" shape="circle" />
              </Card>
            ))}
          </div>
        ) : sessions.length === 0 ? (
          // First-run: dual CTAs
          <div className="grid sm:grid-cols-2 gap-4 max-w-3xl mx-auto pt-8">
            <Card
              raised
              padding="lg"
              interactive
              onClick={creatingSample ? undefined : handleSample}
              className="text-center flex flex-col items-center gap-3 border-gold-700/40 bg-gradient-to-b from-gold-900/20 to-parchment-900"
            >
              <div className="text-5xl mt-2" aria-hidden>
                ✨
              </div>
              <h3 className="font-display text-lg text-gold-300">Probá la sesión de ejemplo</h3>
              <p className="text-vellum-300 text-sm leading-relaxed">
                Una sesión pre-armada con guión, audio, mapas y combatientes para que veas
                cómo funciona todo. Podés borrarla cuando quieras.
              </p>
              <Button
                variant="primary"
                onClick={handleSample}
                loading={creatingSample}
                iconBefore="▶"
                className="mt-2"
              >
                Cargar ejemplo
              </Button>
            </Card>
            <Card
              padding="lg"
              interactive
              onClick={() => setShowNew(true)}
              className="text-center flex flex-col items-center gap-3"
            >
              <div className="text-5xl mt-2 opacity-50" aria-hidden>
                🗺
              </div>
              <h3 className="font-display text-lg text-vellum-100">Crear sesión vacía</h3>
              <p className="text-vellum-300 text-sm leading-relaxed">
                Empezá desde cero. Vas a tener que importar tus propios audios e imágenes.
              </p>
              <Button variant="secondary" onClick={() => setShowNew(true)} iconBefore="+" className="mt-2">
                Nueva Sesión
              </Button>
            </Card>
          </div>
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

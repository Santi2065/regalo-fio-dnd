import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  getManuals,
  deleteManual,
  importManual,
  type Manual,
  type ImportProgress,
} from "../../lib/manuals";
import { toast } from "../../lib/toast";
import { formatDateShort } from "../../lib/formatDate";
import { clearStatBlockCache } from "../../lib/statBlockCache";
import { Button, Card, ConfirmDialog, EmptyState, IconButton, KeyboardKey } from "../ui";

interface JobState {
  job_id: string;
  phase: ImportProgress["phase"];
  percent: number;
  status_text: string;
}

export default function ManualsList() {
  const [manuals, setManuals] = useState<Manual[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<Record<string, JobState>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<Manual | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setManuals(await getManuals());
    } catch (e) {
      console.error("[ManualsList] refresh failed", e);
      toast.error("No se pudieron cargar los manuales");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Subscribe to import progress events; refresh on done.
  useEffect(() => {
    const unlistenP = listen<ImportProgress>("manual-import-progress", (event) => {
      const p = event.payload;
      setJobs((prev) => ({ ...prev, [p.job_id]: p }));
      if (p.phase === "done") {
        toast.success(p.status_text);
        refresh();
        // Drop the job from the visible state after a beat so the bar finishes.
        setTimeout(() => {
          setJobs((prev) => {
            const next = { ...prev };
            delete next[p.job_id];
            return next;
          });
        }, 1500);
      } else if (p.phase === "error") {
        toast.error(`Error indexando manual: ${p.status_text}`);
        setTimeout(() => {
          setJobs((prev) => {
            const next = { ...prev };
            delete next[p.job_id];
            return next;
          });
        }, 4000);
        refresh();
      }
    });
    return () => {
      unlistenP.then((fn) => fn());
    };
  }, [refresh]);

  const handleImport = async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!selected || typeof selected !== "string") return;
    try {
      const jobId = await importManual(selected);
      setJobs((prev) => ({
        ...prev,
        [jobId]: {
          job_id: jobId,
          phase: "extracting",
          percent: 0,
          status_text: "Iniciando...",
        },
      }));
      // Refresh para que aparezca el manual en estado "indexando"
      refresh();
    } catch (e) {
      console.error("[ManualsList] import failed", e);
      const detail = typeof e === "string" ? e : (e as Error)?.message ?? "";
      toast.error(detail ? `Importar falló: ${detail}` : "No se pudo importar el PDF");
    }
  };

  const handleDelete = async (manual: Manual) => {
    setDeleting(true);
    try {
      await deleteManual(manual.id);
      setDeleteConfirm(null);
      // Stat blocks de este manual ya no existen — limpiar cache para que
      // la fila de Iniciativa correspondiente pierda el indicador 📖.
      clearStatBlockCache();
      toast.success("Manual eliminado");
      refresh();
    } catch (e) {
      console.error("[ManualsList] delete failed", e);
      toast.error("No se pudo eliminar el manual");
    } finally {
      setDeleting(false);
    }
  };

  const activeJobs = Object.values(jobs);

  return (
    <div className="flex flex-col h-full p-4 gap-3 overflow-y-auto">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="font-display text-lg text-vellum-100">Manuales</h2>
          <p className="text-xs text-vellum-400">
            Importá PDFs y consultalos con <KeyboardKey size="sm">Ctrl</KeyboardKey>
            <span className="mx-0.5">+</span>
            <KeyboardKey size="sm">K</KeyboardKey>
          </p>
        </div>
        <Button variant="primary" size="md" onClick={handleImport} iconBefore="+">
          Importar PDF
        </Button>
      </div>

      {/* Active import jobs */}
      {activeJobs.length > 0 && (
        <div className="space-y-2 flex-shrink-0">
          {activeJobs.map((j) => (
            <Card key={j.job_id} padding="sm" className="bg-parchment-800/60">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-vellum-100 font-medium">{j.status_text}</span>
                <span className="text-vellum-400 tabular-nums">{j.percent}%</span>
              </div>
              <div className="h-1.5 bg-parchment-900 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    j.phase === "error" ? "bg-danger-500" : "bg-gold-500"
                  }`}
                  style={{ width: `${Math.max(j.percent, 5)}%` }}
                />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* List */}
      <div className="flex-1 min-h-0">
        {loading ? (
          <p className="text-vellum-400 text-sm text-center py-8">Cargando...</p>
        ) : manuals.length === 0 ? (
          <EmptyState
            size="md"
            icon="📚"
            title="Aún no hay manuales"
            description={
              <>
                Importá tus PDFs (Player's Handbook, Monster Manual, módulos…) y
                consultalos durante la sesión con búsqueda semántica desde{" "}
                <KeyboardKey size="sm">Ctrl</KeyboardKey>
                <span className="mx-0.5">+</span>
                <KeyboardKey size="sm">K</KeyboardKey>.
              </>
            }
            action={
              <Button variant="primary" onClick={handleImport} iconBefore="+">
                Importar primer PDF
              </Button>
            }
          />
        ) : (
          <div className="grid gap-2">
            {manuals.map((m) => {
              const indexed = !!m.indexed_at;
              return (
                <Card
                  key={m.id}
                  padding="md"
                  className="flex items-center justify-between"
                >
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-vellum-50 text-sm truncate">
                      📖 {m.name}
                    </h3>
                    <p className="text-xs text-vellum-400 mt-0.5">
                      {indexed ? (
                        <>
                          {m.page_count} páginas · {m.chunk_count} fragmentos
                          indexados · {formatDateShort(m.created_at)}
                        </>
                      ) : (
                        <span className="text-warning-300">Indexando...</span>
                      )}
                    </p>
                  </div>
                  <IconButton
                    label="Eliminar manual"
                    variant="danger"
                    size="sm"
                    onClick={() => setDeleteConfirm(m)}
                  >
                    🗑
                  </IconButton>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteConfirm}
        title="¿Eliminar manual?"
        description={
          deleteConfirm
            ? `Se borrará "${deleteConfirm.name}" del índice y el archivo PDF de la app. Tu PDF original no se toca.`
            : ""
        }
        confirmLabel="Eliminar"
        danger
        loading={deleting}
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
      />
    </div>
  );
}

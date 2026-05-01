import { useEffect, useState } from "react";
import {
  checkForUpdate,
  downloadAndInstall,
  relaunchApp,
  type UpdaterStage,
} from "../lib/updater";

/**
 * Updater toast — overlay flotante abajo a la derecha que coordina el
 * flujo de auto-update.
 *
 * UX:
 * 1. Al montar (después de 3s para no pisar el arranque), chequea silencioso.
 * 2. Si hay nueva versión, arranca a descargar sola con barra de progreso.
 * 3. Al terminar la instalación, modal: "Reiniciar ahora / Después".
 * 4. Si elige "Después", queda un pill discreto en la esquina con
 *    "Reiniciar para actualizar".
 *
 * Sin internet o sin release: silencioso, no muestra nada al usuario.
 *
 * El componente se monta una sola vez en App.tsx — no necesita props.
 */
export default function UpdaterToast() {
  const [stage, setStage] = useState<UpdaterStage>({ kind: "idle" });
  const [showInstallModal, setShowInstallModal] = useState(false);

  // Arranque del flujo: chequeo silencioso a los 3s de cargada la app.
  useEffect(() => {
    const t = setTimeout(async () => {
      setStage({ kind: "checking" });
      const update = await checkForUpdate();
      if (!update) {
        setStage({ kind: "idle" });
        return;
      }
      setStage({
        kind: "available",
        update,
        version: update.version,
        notes: update.body ?? null,
      });

      // Auto-descarga: el user pidió "que se actualice sola".
      setStage({
        kind: "downloading",
        version: update.version,
        progress: { downloaded: 0, total: null, fraction: null },
      });
      try {
        await downloadAndInstall(update, (progress) => {
          setStage((prev) =>
            prev.kind === "downloading"
              ? { ...prev, progress }
              : prev,
          );
        });
        setStage({ kind: "ready", version: update.version });
        setShowInstallModal(true);
      } catch (e) {
        console.error("[updater] descarga falló", e);
        setStage({ kind: "error", message: errorMessage(e) });
      }
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  const handleRelaunch = async () => {
    try {
      await relaunchApp();
    } catch (e) {
      console.error("[updater] relaunch falló", e);
    }
  };

  // Render según stage
  if (stage.kind === "idle" || stage.kind === "checking") return null;

  return (
    <>
      {/* Toast bottom-right durante descarga */}
      {stage.kind === "downloading" && (
        <ToastCard>
          <p className="text-xs text-vellum-300 mb-1">
            Descargando actualización
          </p>
          <p className="text-sm text-gold-300 font-medium mb-2">
            v{stage.version}
          </p>
          <ProgressBar fraction={stage.progress.fraction} />
          <p className="text-[10px] text-vellum-400 mt-1 tabular-nums">
            {formatBytes(stage.progress.downloaded)}
            {stage.progress.total
              ? ` / ${formatBytes(stage.progress.total)}`
              : ""}
          </p>
        </ToastCard>
      )}

      {/* Pill cuando ya está listo y el user pidió "después" */}
      {stage.kind === "ready" && !showInstallModal && (
        <button
          onClick={() => setShowInstallModal(true)}
          className="fixed bottom-4 right-4 z-50 bg-amber-700 hover:bg-amber-600 text-white text-xs px-3 py-1.5 rounded-full shadow-lg transition-colors flex items-center gap-1.5"
          title={`Update v${stage.version} listo. Reiniciar para aplicar.`}
        >
          <span>↻</span>
          <span>Reiniciar para actualizar</span>
        </button>
      )}

      {/* Modal "Reiniciar ahora / Después" */}
      {stage.kind === "ready" && showInstallModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60]">
          <div className="bg-parchment-900 border border-parchment-700 rounded-xl p-6 w-96 max-w-[90vw] shadow-2xl">
            <h3 className="text-vellum-50 font-semibold text-lg mb-1">
              Actualización lista
            </h3>
            <p className="text-vellum-300 text-sm mb-4">
              La versión <strong className="text-gold-300">v{stage.version}</strong>{" "}
              ya está descargada e instalada. Reiniciá la app para aplicar los
              cambios.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowInstallModal(false)}
                className="px-4 py-1.5 text-vellum-300 hover:text-vellum-100 text-sm transition-colors"
              >
                Después
              </button>
              <button
                onClick={handleRelaunch}
                className="px-4 py-1.5 bg-amber-700 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Reiniciar ahora
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error: pill silencioso, no bloquea nada */}
      {stage.kind === "error" && (
        <div
          className="fixed bottom-4 right-4 z-50 bg-stone-800 border border-red-900/40 text-red-300 text-xs px-3 py-1.5 rounded-lg shadow"
          title={stage.message}
        >
          Update falló (ver consola)
        </div>
      )}
    </>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

function ToastCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 bg-parchment-900/95 border border-parchment-700 rounded-lg shadow-xl p-3 w-72 backdrop-blur">
      {children}
    </div>
  );
}

function ProgressBar({ fraction }: { fraction: number | null }) {
  if (fraction === null) {
    return (
      <div className="h-1.5 bg-parchment-800 rounded-full overflow-hidden">
        <div className="h-full w-1/3 bg-gold-500 rounded-full animate-pulse" />
      </div>
    );
  }
  return (
    <div className="h-1.5 bg-parchment-800 rounded-full overflow-hidden">
      <div
        className="h-full bg-gold-500 rounded-full transition-all"
        style={{ width: `${Math.round(fraction * 100)}%` }}
      />
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

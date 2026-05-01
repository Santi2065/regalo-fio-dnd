import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { toast } from "../lib/toast";

interface Props {
  open: boolean;
  manualName: string;
  filePath: string;
  pageNumber: number;
  onClose: () => void;
}

/**
 * Modal con un iframe que muestra el PDF y hace scroll a la página
 * indicada via el anchor `#page=N`. La WebView Chromium-based de Tauri
 * (Edge WebView2 en Windows, WebKit2GTK en Linux) maneja PDFs nativos.
 * Si el iframe no carga (algunos sistemas / configs), el fallback es
 * abrir el PDF en el visor externo del SO.
 */
export default function ManualPageViewer({
  open,
  manualName,
  filePath,
  pageNumber,
  onClose,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const url = `${convertFileSrc(filePath)}#page=${pageNumber}`;

  const handleExternal = async () => {
    try {
      await openPath(filePath);
    } catch (e) {
      console.error("[ManualPageViewer] open external failed", e);
      toast.error("No se pudo abrir el PDF en el visor externo");
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9100] flex items-center justify-center p-4 animate-backdrop-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-viewer-title"
    >
      <div className="absolute inset-0 bg-parchment-950/85 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-5xl h-[88vh] bg-parchment-900 border border-parchment-700 rounded-xl shadow-candlelight animate-modal-in flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-parchment-800 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-gold-300">📖</span>
            <h3
              id="manual-viewer-title"
              className="font-display text-sm text-vellum-100 truncate"
            >
              {manualName}
            </h3>
            <span className="text-vellum-400 text-xs flex-shrink-0">
              · pág. {pageNumber}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleExternal}
              className="text-xs text-gold-400 hover:text-gold-300 transition-colors"
              title="Abrir el PDF en el visor del sistema"
            >
              Abrir externo ↗
            </button>
            <button
              onClick={onClose}
              className="text-vellum-400 hover:text-vellum-100 text-lg leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-parchment-800"
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>
        </div>

        {/* PDF iframe */}
        <div className="flex-1 min-h-0 bg-parchment-950">
          <iframe
            key={`${filePath}#${pageNumber}`}
            src={url}
            className="w-full h-full border-none"
            title={`${manualName} — página ${pageNumber}`}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

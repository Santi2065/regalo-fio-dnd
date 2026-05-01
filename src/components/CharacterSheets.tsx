import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import type { Asset } from "../lib/types";
import { toast } from "../lib/toast";

interface Props {
  sessionId: string;
}

export default function CharacterSheets({ sessionId }: Props) {
  const [sheets, setSheets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"session" | "global">("session");
  const [selected, setSelected] = useState<Asset | null>(null);

  const loadSheets = useCallback(async () => {
    setLoading(true);
    const effectiveId = scope === "session" ? sessionId : null;
    try {
      const result = await invoke<Asset[]>("get_assets", {
        sessionId: effectiveId,
        assetTypeFilter: "character_sheet",
      });
      setSheets(result);
    } finally {
      setLoading(false);
    }
  }, [sessionId, scope]);

  useEffect(() => {
    loadSheets();
  }, [loadSheets]);

  const handleImport = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const files = await open({
      multiple: true,
      filters: [{ name: "Fichas", extensions: ["jpg", "jpeg", "png", "webp", "pdf"] }],
    });
    if (!files || files.length === 0) return;

    const effectiveId = scope === "session" ? sessionId : null;
    const imported = await invoke<Asset[]>("import_assets", {
      sessionId: effectiveId,
      filePaths: Array.isArray(files) ? files : [files],
    });

    // Auto-reclassify imported assets as character_sheet
    await Promise.all(
      imported.map((a) =>
        invoke("update_asset", { id: a.id, name: a.name, tags: a.tags, assetType: "character_sheet" })
      )
    );

    loadSheets();
  };

  return (
    <div className="flex h-full min-h-0">
      {/* List */}
      <div className="flex flex-col h-full flex-1 min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-stone-800 flex-shrink-0">
          <span className="text-sm font-medium text-stone-300">Fichas de personaje</span>

          <div className="flex bg-stone-800 rounded-lg p-0.5 gap-0.5 ml-auto">
            <button
              onClick={() => setScope("session")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                scope === "session" ? "bg-stone-600 text-stone-100" : "text-stone-400 hover:text-stone-200"
              }`}
            >
              Esta sesión
            </button>
            <button
              onClick={() => setScope("global")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                scope === "global" ? "bg-stone-600 text-stone-100" : "text-stone-400 hover:text-stone-200"
              }`}
            >
              Global
            </button>
          </div>

          <button
            onClick={handleImport}
            className="flex-shrink-0 bg-amber-700 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          >
            + Importar
          </button>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="text-stone-600 text-sm text-center py-16 animate-pulse">Cargando...</div>
          ) : sheets.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-3 opacity-20">👤</div>
              <p className="text-stone-500 text-sm mb-2">Sin fichas de personaje</p>
              <p className="text-stone-700 text-xs max-w-xs mx-auto">
                Importá PDFs o imágenes con el botón de arriba, o cambiá el tipo de un asset existente a "Ficha de personaje" en la pestaña Assets.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
              {sheets.map((sheet) => (
                <SheetCard
                  key={sheet.id}
                  sheet={sheet}
                  isSelected={selected?.id === sheet.id}
                  onClick={() => setSelected(sheet.id === selected?.id ? null : sheet)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Viewer */}
      {selected && (
        <div className="w-96 flex-shrink-0 border-l border-stone-800 flex flex-col bg-stone-900/30">
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800 flex-shrink-0">
            <p className="text-sm font-medium text-stone-200 truncate pr-2">{selected.name}</p>
            <button
              onClick={() => setSelected(null)}
              className="text-stone-500 hover:text-stone-300 text-lg leading-none flex-shrink-0"
            >
              ×
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {selected.asset_type === "character_sheet" && selected.file_path.match(/\.(jpg|jpeg|png|webp|gif)$/i) ? (
              <img
                src={convertFileSrc(selected.file_path)}
                alt={selected.name}
                className="w-full h-full object-contain bg-stone-950"
              />
            ) : selected.file_path.endsWith(".pdf") ? (
              <PdfViewer filePath={selected.file_path} title={selected.name} />
            ) : (
              <div className="flex items-center justify-center h-full text-stone-600 text-sm">
                <div className="text-center">
                  <div className="text-4xl mb-2">📄</div>
                  <p>Vista previa no disponible</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SheetCard({
  sheet,
  isSelected,
  onClick,
}: {
  sheet: Asset;
  isSelected: boolean;
  onClick: () => void;
}) {
  const thumb = sheet.thumbnail_path ? convertFileSrc(sheet.thumbnail_path) : null;
  const isPdf = sheet.file_path.endsWith(".pdf");

  return (
    <div
      onClick={onClick}
      className={`group rounded-xl border-2 cursor-pointer transition-all overflow-hidden hover:scale-102 ${
        isSelected
          ? "border-amber-500 ring-2 ring-amber-500/30"
          : "border-stone-700 hover:border-stone-500"
      }`}
    >
      <div className="aspect-[3/4] bg-stone-900 flex items-center justify-center overflow-hidden">
        {thumb ? (
          <img src={thumb} alt={sheet.name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-4xl opacity-30">{isPdf ? "📄" : "👤"}</span>
        )}
      </div>
      <div className="p-2 bg-stone-800/50">
        <p className="text-xs text-stone-300 truncate" title={sheet.name}>
          {sheet.name.replace(/\.[^.]+$/, "")}
        </p>
      </div>
    </div>
  );
}

function PdfViewer({ filePath, title }: { filePath: string; title: string }) {
  const [errored, setErrored] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const openExternal = async () => {
    try {
      await openPath(filePath);
    } catch (e) {
      console.error("[PdfViewer] open external failed", e);
      toast.error("No se pudo abrir el PDF en el visor externo");
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-stone-800 bg-stone-900/40 text-xs">
        <span className="text-vellum-400 truncate">PDF · {title}</span>
        <button
          onClick={openExternal}
          className="text-gold-400 hover:text-gold-300 transition-colors flex-shrink-0"
        >
          Abrir en visor externo ↗
        </button>
      </div>
      <div className="flex-1 min-h-0 relative">
        {errored ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-vellum-400 text-sm max-w-xs">
              <div className="text-4xl mb-3 opacity-60">📄</div>
              <p className="mb-3">No se pudo previsualizar el PDF dentro de la app.</p>
              <button
                onClick={openExternal}
                className="bg-gold-600 hover:bg-gold-500 text-parchment-950 px-3 py-1.5 rounded-md text-xs font-medium"
              >
                Abrir en visor externo
              </button>
            </div>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={convertFileSrc(filePath)}
            className="w-full h-full border-none"
            title={title}
            onError={() => setErrored(true)}
          />
        )}
      </div>
    </div>
  );
}

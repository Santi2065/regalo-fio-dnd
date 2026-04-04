import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Asset, AssetType } from "../lib/types";
import AssetCard from "./AssetCard";
import AssetPreview from "./AssetPreview";

interface Props {
  sessionId: string;
}

const TYPE_FILTERS: { key: AssetType; label: string; icon: string }[] = [
  { key: "all", label: "Todo", icon: "📦" },
  { key: "image", label: "Imágenes", icon: "🖼" },
  { key: "audio", label: "Audio", icon: "🔊" },
  { key: "document", label: "Documentos", icon: "📄" },
  { key: "video", label: "Video", icon: "🎬" },
];

export default function AssetBrowser({ sessionId }: Props) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filter, setFilter] = useState<AssetType>("all");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [preview, setPreview] = useState<Asset | null>(null);
  const [search, setSearch] = useState("");
  const unlistenRef = useRef<(() => void) | null>(null);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<Asset[]>("get_assets", {
        sessionId,
        assetTypeFilter: filter === "all" ? null : filter,
      });
      setAssets(result);
    } finally {
      setLoading(false);
    }
  }, [sessionId, filter]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  // Drag and drop file import
  useEffect(() => {
    let cancelled = false;

    getCurrentWebview().onDragDropEvent((event) => {
      if (cancelled) return;
      if (event.payload.type === "over") {
        setIsDragOver(true);
      } else if (event.payload.type === "leave") {
        setIsDragOver(false);
      } else if (event.payload.type === "drop") {
        setIsDragOver(false);
        const paths = (event.payload as any).paths as string[];
        if (paths && paths.length > 0) {
          handleImport(paths);
        }
      }
    }).then((unlisten) => {
      if (!cancelled) unlistenRef.current = unlisten;
    });

    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
  }, [sessionId]);

  const handleImport = async (paths: string[]) => {
    setImporting(true);
    try {
      const newAssets = await invoke<Asset[]>("import_assets", { sessionId, filePaths: paths });
      setAssets((prev) => [...newAssets, ...prev]);
    } finally {
      setImporting(false);
    }
  };

  const handlePickFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [
        { name: "Imágenes", extensions: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"] },
        { name: "Audio", extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac"] },
        { name: "Documentos", extensions: ["pdf", "txt", "md"] },
        { name: "Todos los archivos", extensions: ["*"] },
      ],
    });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      await handleImport(paths);
    }
  };

  const handleDelete = async (asset: Asset) => {
    await invoke("delete_asset", { id: asset.id });
    setAssets((prev) => prev.filter((a) => a.id !== asset.id));
    if (preview?.id === asset.id) setPreview(null);
  };

  const filteredAssets = assets.filter((a) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      a.name.toLowerCase().includes(q) ||
      a.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  return (
    <div className="flex h-full">
      {/* Main panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-stone-800 flex-shrink-0">
          {/* Type filters */}
          <div className="flex gap-1">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filter === f.key
                    ? "bg-amber-700 text-white"
                    : "bg-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-700"
                }`}
              >
                {f.icon} {f.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar assets..."
            className="flex-1 max-w-xs bg-stone-800 border border-stone-700 rounded-lg px-3 py-1.5 text-sm text-stone-200 placeholder-stone-500 focus:outline-none focus:border-stone-500"
          />

          <div className="ml-auto flex items-center gap-2">
            {importing && <span className="text-stone-400 text-xs animate-pulse">Importando...</span>}
            <button
              onClick={handlePickFiles}
              disabled={importing}
              className="bg-stone-700 hover:bg-stone-600 disabled:opacity-50 text-stone-200 px-3 py-1.5 rounded-lg text-sm transition-colors"
            >
              + Importar archivos
            </button>
          </div>
        </div>

        {/* Drop zone / grid */}
        <div
          className={`flex-1 overflow-y-auto p-4 transition-colors ${
            isDragOver ? "bg-amber-900/10 border-2 border-dashed border-amber-600" : ""
          }`}
        >
          {isDragOver && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="bg-stone-900/90 border border-amber-600 rounded-xl px-8 py-6 text-center">
                <div className="text-4xl mb-2">📥</div>
                <p className="text-amber-400 font-medium">Suelta los archivos aquí</p>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center text-stone-500 py-16">Cargando assets...</div>
          ) : filteredAssets.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-3">
                {search ? "🔍" : "📭"}
              </div>
              <p className="text-stone-500 text-sm">
                {search
                  ? "Sin resultados para esa búsqueda"
                  : "Sin assets todavía. Arrastrá archivos aquí o usá el botón de importar."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {filteredAssets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  selected={preview?.id === asset.id}
                  onClick={() => setPreview(asset)}
                  onDelete={() => handleDelete(asset)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Preview panel */}
      {preview && (
        <div className="w-72 flex-shrink-0 border-l border-stone-800 bg-stone-900/40">
          <AssetPreview
            asset={preview}
            onClose={() => setPreview(null)}
            onDelete={() => handleDelete(preview)}
            onUpdate={(updated) => {
              setAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
              setPreview(updated);
            }}
          />
        </div>
      )}
    </div>
  );
}

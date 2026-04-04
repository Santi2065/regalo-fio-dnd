import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Asset } from "../lib/types";

interface MonitorInfo {
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  is_primary: boolean;
}

interface Props {
  sessionId: string;
}

export default function DisplayPanel({ sessionId }: Props) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [selectedMonitor, setSelectedMonitor] = useState<MonitorInfo | null>(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [currentScene, setCurrentScene] = useState<Asset | null>(null);
  const [filterType, setFilterType] = useState<"all" | "image" | "video">("all");

  const refresh = useCallback(async () => {
    const [mons, isOpen, imageAssets, videoAssets] = await Promise.all([
      invoke<MonitorInfo[]>("get_monitors"),
      invoke<boolean>("player_display_open"),
      invoke<Asset[]>("get_assets", { sessionId, assetTypeFilter: "image" }),
      invoke<Asset[]>("get_assets", { sessionId, assetTypeFilter: "video" }),
    ]);
    setMonitors(mons);
    setDisplayOpen(isOpen);
    setAssets([...imageAssets, ...videoAssets]);

    // Default to non-primary monitor
    if (!selectedMonitor) {
      const secondary = mons.find((m) => !m.is_primary) ?? mons[0] ?? null;
      setSelectedMonitor(secondary);
    }
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleOpenDisplay = async () => {
    if (!selectedMonitor) return;
    await invoke("open_player_display", {
      monitorX: selectedMonitor.x,
      monitorY: selectedMonitor.y,
      monitorWidth: selectedMonitor.width,
      monitorHeight: selectedMonitor.height,
    });
    setDisplayOpen(true);
  };

  const handleCloseDisplay = async () => {
    await invoke("close_player_display");
    setDisplayOpen(false);
    setCurrentScene(null);
  };

  const handleProject = async (asset: Asset) => {
    await invoke("project_scene", {
      scene: {
        file_path: asset.file_path,
        asset_type: asset.asset_type,
        title: asset.name,
      },
    });
    setCurrentScene(asset);
  };

  const handleClear = async () => {
    await invoke("clear_player_display");
    setCurrentScene(null);
  };

  const filtered = assets.filter((a) =>
    filterType === "all" ? true : a.asset_type === filterType
  );

  return (
    <div className="flex h-full">
      {/* Left: controls */}
      <div className="w-72 flex-shrink-0 border-r border-stone-800 flex flex-col bg-stone-900/30">
        {/* Monitor selection */}
        <div className="p-4 border-b border-stone-800">
          <p className="text-sm font-medium text-stone-300 mb-3">Monitor de proyección</p>
          <div className="space-y-2">
            {monitors.map((m) => (
              <label
                key={m.name}
                className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  selectedMonitor?.name === m.name
                    ? "border-amber-600 bg-amber-900/20"
                    : "border-stone-700 hover:border-stone-500"
                }`}
              >
                <input
                  type="radio"
                  name="monitor"
                  checked={selectedMonitor?.name === m.name}
                  onChange={() => setSelectedMonitor(m)}
                  className="accent-amber-500"
                />
                <div>
                  <p className="text-sm text-stone-200">{m.name}</p>
                  <p className="text-xs text-stone-500">
                    {m.width}×{m.height}
                    {m.is_primary ? " · Principal" : " · Secundario"}
                  </p>
                </div>
              </label>
            ))}
          </div>

          <div className="flex gap-2 mt-3">
            {!displayOpen ? (
              <button
                onClick={handleOpenDisplay}
                disabled={!selectedMonitor}
                className="flex-1 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium transition-colors"
              >
                🖥 Abrir pantalla
              </button>
            ) : (
              <button
                onClick={handleCloseDisplay}
                className="flex-1 bg-stone-700 hover:bg-stone-600 text-stone-300 py-2 rounded-lg text-sm transition-colors"
              >
                Cerrar pantalla
              </button>
            )}
          </div>

          {displayOpen && (
            <div className="mt-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
              <span className="text-xs text-green-400">Pantalla activa</span>
              <button
                onClick={handleClear}
                className="ml-auto text-xs text-stone-500 hover:text-stone-300 transition-colors"
              >
                Limpiar
              </button>
            </div>
          )}
        </div>

        {/* Current scene preview */}
        {currentScene && (
          <div className="p-4 border-b border-stone-800">
            <p className="text-xs text-stone-500 mb-2">Proyectando ahora</p>
            <div className="rounded-lg overflow-hidden bg-stone-900 aspect-video flex items-center justify-center">
              {currentScene.asset_type === "image" ? (
                <img
                  src={convertFileSrc(currentScene.file_path)}
                  alt={currentScene.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-3xl">🎬</span>
              )}
            </div>
            <p className="text-xs text-stone-400 mt-1 truncate">{currentScene.name}</p>
          </div>
        )}

        {!displayOpen && (
          <div className="p-4 flex-1 flex items-center justify-center text-center">
            <div>
              <div className="text-4xl mb-2 opacity-30">🖥</div>
              <p className="text-stone-600 text-xs">
                Abrí la pantalla de proyección para empezar
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Right: asset grid */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-6 py-3 border-b border-stone-800 flex-shrink-0">
          <span className="text-sm text-stone-400">Mostrar:</span>
          {(["all", "image", "video"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                filterType === t
                  ? "bg-amber-700 text-white"
                  : "bg-stone-800 text-stone-400 hover:text-stone-200"
              }`}
            >
              {t === "all" ? "Todo" : t === "image" ? "🖼 Imágenes" : "🎬 Video"}
            </button>
          ))}
          <p className="ml-auto text-xs text-stone-600">
            Click para proyectar
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!displayOpen ? (
            <div className="text-center py-16 text-stone-600 text-sm">
              Abrí la pantalla de proyección primero
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-4xl mb-2">📭</div>
              <p className="text-stone-500 text-sm">
                Sin imágenes o videos. Importá assets desde la pestaña Assets.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
              {filtered.map((asset) => (
                <DisplayAssetCard
                  key={asset.id}
                  asset={asset}
                  isActive={currentScene?.id === asset.id}
                  onProject={() => handleProject(asset)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface CardProps {
  asset: Asset;
  isActive: boolean;
  onProject: () => void;
}

function DisplayAssetCard({ asset, isActive, onProject }: CardProps) {
  const thumb = asset.thumbnail_path
    ? convertFileSrc(asset.thumbnail_path)
    : null;

  return (
    <div
      onClick={onProject}
      className={`group rounded-xl border-2 cursor-pointer transition-all overflow-hidden hover:scale-105 ${
        isActive
          ? "border-amber-500 ring-2 ring-amber-500/30"
          : "border-stone-700 hover:border-stone-500"
      }`}
    >
      <div className="aspect-video bg-stone-900 flex items-center justify-center overflow-hidden">
        {thumb ? (
          <img src={thumb} alt={asset.name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-3xl">
            {asset.asset_type === "video" ? "🎬" : "🖼"}
          </span>
        )}
      </div>
      <div className="p-2 bg-stone-800/50">
        <p className="text-xs text-stone-300 truncate" title={asset.name}>
          {asset.name}
        </p>
        {isActive && (
          <p className="text-xs text-amber-400 mt-0.5">▶ Proyectando</p>
        )}
      </div>
    </div>
  );
}

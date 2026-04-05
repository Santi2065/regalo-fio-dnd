import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Asset } from "../lib/types";
import FogPainter from "./FogPainter";

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
  compact?: boolean;
}

export default function DisplayPanel({ sessionId, compact = false }: Props) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [selectedMonitor, setSelectedMonitor] = useState<MonitorInfo | null>(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [currentScene, setCurrentScene] = useState<Asset | null>(null);
  const [filterType, setFilterType] = useState<"all" | "image" | "video">("all");
  const [rightTab, setRightTab] = useState<"scenes" | "fog">("scenes");

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

  if (compact) {
    return (
      <div className="flex flex-col h-full">
        {/* Monitor + open/close controls */}
        <div className="px-3 py-2 border-b border-stone-800 flex-shrink-0 space-y-2">
          <div className="flex items-center gap-2">
            <select
              value={selectedMonitor?.name ?? ""}
              onChange={(e) => {
                const m = monitors.find((mon) => mon.name === e.target.value);
                if (m) setSelectedMonitor(m);
              }}
              className="flex-1 bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-stone-200 focus:outline-none focus:border-amber-500 min-w-0"
            >
              {monitors.length === 0 && <option value="">Sin monitores</option>}
              {monitors.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name} ({m.width}×{m.height}){m.is_primary ? " — Principal" : ""}
                </option>
              ))}
            </select>
            {!displayOpen ? (
              <button
                onClick={handleOpenDisplay}
                disabled={!selectedMonitor}
                className="flex-shrink-0 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white px-2 py-1 rounded text-xs font-medium transition-colors"
              >
                🖥 Abrir
              </button>
            ) : (
              <button
                onClick={handleCloseDisplay}
                className="flex-shrink-0 bg-stone-700 hover:bg-stone-600 text-stone-300 px-2 py-1 rounded text-xs transition-colors"
              >
                Cerrar
              </button>
            )}
          </div>

          {displayOpen && (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
              <span className="text-xs text-green-400 flex-1">Activa</span>
              {currentScene && (
                <span className="text-xs text-stone-500 truncate max-w-[120px]">{currentScene.name}</span>
              )}
              <button onClick={handleClear} className="text-xs text-stone-600 hover:text-stone-300 transition-colors flex-shrink-0">
                Limpiar
              </button>
            </div>
          )}
        </div>

        {/* Tab bar: scenes / fog */}
        <div className="flex border-b border-stone-800 flex-shrink-0">
          <button
            onClick={() => setRightTab("scenes")}
            className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 ${rightTab === "scenes" ? "border-amber-500 text-amber-400" : "border-transparent text-stone-500 hover:text-stone-300"}`}
          >
            🖼 Escenas
          </button>
          <button
            onClick={() => setRightTab("fog")}
            disabled={!currentScene || currentScene.asset_type !== "image"}
            className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 disabled:opacity-40 disabled:cursor-not-allowed ${rightTab === "fog" ? "border-indigo-500 text-indigo-400" : "border-transparent text-stone-500 hover:text-stone-300"}`}
          >
            🌫 Niebla
          </button>
          {rightTab === "scenes" && (
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as typeof filterType)}
              className="bg-transparent border-l border-stone-800 text-xs text-stone-500 px-2 focus:outline-none"
            >
              <option value="all">Todo</option>
              <option value="image">Imágenes</option>
              <option value="video">Video</option>
            </select>
          )}
        </div>

        {/* Scenes */}
        {rightTab === "scenes" && (
          <div className="flex-1 overflow-y-auto p-2">
            {!displayOpen ? (
              <p className="text-stone-600 text-xs text-center py-8">Abrí la pantalla primero</p>
            ) : filtered.length === 0 ? (
              <p className="text-stone-600 text-xs text-center py-8">Sin imágenes/videos</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {filtered.map((asset) => (
                  <DisplayAssetCard
                    key={asset.id}
                    asset={asset}
                    isActive={currentScene?.id === asset.id}
                    onProject={() => { handleProject(asset); if (asset.asset_type === "image") setRightTab("fog"); }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Fog */}
        {rightTab === "fog" && currentScene && currentScene.asset_type === "image" && (
          <div className="flex-1 min-h-0 p-2 flex flex-col">
            <FogPainter scene={currentScene} />
          </div>
        )}
      </div>
    );
  }

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

      {/* Right: tabs (scenes / fog of war) */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tab bar */}
        <div className="flex border-b border-stone-800 flex-shrink-0">
          <button
            onClick={() => setRightTab("scenes")}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              rightTab === "scenes"
                ? "border-amber-500 text-amber-400"
                : "border-transparent text-stone-400 hover:text-stone-200"
            }`}
          >
            🖼 Escenas
          </button>
          <button
            onClick={() => setRightTab("fog")}
            disabled={!currentScene || currentScene.asset_type !== "image"}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px disabled:opacity-40 disabled:cursor-not-allowed ${
              rightTab === "fog"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-stone-400 hover:text-stone-200"
            }`}
            title={!currentScene ? "Proyectá una imagen primero" : undefined}
          >
            🌫 Niebla de guerra
          </button>

          {rightTab === "scenes" && (
            <div className="ml-auto flex items-center gap-2 px-4">
              {(["all", "image", "video"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    filterType === t
                      ? "bg-amber-700 text-white"
                      : "bg-stone-800 text-stone-400 hover:text-stone-200"
                  }`}
                >
                  {t === "all" ? "Todo" : t === "image" ? "Imágenes" : "Video"}
                </button>
              ))}
              <span className="text-xs text-stone-600 ml-1">Click = proyectar</span>
            </div>
          )}
        </div>

        {/* Scenes tab */}
        {rightTab === "scenes" && (
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
                    onProject={() => {
                      handleProject(asset);
                      if (asset.asset_type === "image") setRightTab("fog");
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Fog of War tab */}
        {rightTab === "fog" && currentScene && currentScene.asset_type === "image" && (
          <div className="flex-1 min-h-0 p-4 flex flex-col">
            <FogPainter scene={currentScene} />
          </div>
        )}
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

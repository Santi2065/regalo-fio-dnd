import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Asset } from "../lib/types";
import { toast } from "../lib/toast";
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
}

export default function DisplayPanel({ sessionId }: Props) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [selectedMonitor, setSelectedMonitor] = useState<MonitorInfo | null>(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [currentScene, setCurrentScene] = useState<Asset | null>(null);
  const [filterType, setFilterType] = useState<"all" | "image" | "video">("all");
  const [rightTab, setRightTab] = useState<"scenes" | "fog">("scenes");

  const refresh = useCallback(async () => {
    try {
      const [mons, isOpen, imageAssets, videoAssets] = await Promise.all([
        invoke<MonitorInfo[]>("get_monitors"),
        invoke<boolean>("player_display_open"),
        invoke<Asset[]>("get_assets", { sessionId, assetTypeFilter: "image" }),
        invoke<Asset[]>("get_assets", { sessionId, assetTypeFilter: "video" }),
      ]);
      setMonitors(mons);
      setDisplayOpen(isOpen);
      setAssets([...imageAssets, ...videoAssets]);

      if (!selectedMonitor) {
        const secondary = mons.find((m) => !m.is_primary) ?? mons[0] ?? null;
        setSelectedMonitor(secondary);
      }
    } catch (e) {
      console.error("[DisplayPanel] refresh failed", e);
    }
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleOpenDisplay = async () => {
    if (!selectedMonitor) return;
    try {
      await invoke("open_player_display", {
        monitorX: selectedMonitor.x,
        monitorY: selectedMonitor.y,
        monitorWidth: selectedMonitor.width,
        monitorHeight: selectedMonitor.height,
      });
      setDisplayOpen(true);
    } catch (e) {
      console.error("[DisplayPanel] open failed", e);
      toast.error("No se pudo abrir la pantalla de proyección");
    }
  };

  const handleCloseDisplay = async () => {
    try {
      await invoke("close_player_display");
      setDisplayOpen(false);
      setCurrentScene(null);
    } catch (e) {
      console.error("[DisplayPanel] close failed", e);
    }
  };

  const handleProject = async (asset: Asset) => {
    try {
      await invoke("project_scene", {
        scene: {
          file_path: asset.file_path,
          asset_type: asset.asset_type,
          title: asset.name,
        },
      });
      setCurrentScene(asset);
    } catch (e) {
      console.error("[DisplayPanel] project failed", e);
      toast.error("No se pudo proyectar la escena");
    }
  };

  const handleClear = async () => {
    try {
      await invoke("clear_player_display");
      setCurrentScene(null);
    } catch (e) {
      console.error("[DisplayPanel] clear failed", e);
    }
  };

  const filtered = assets.filter((a) =>
    filterType === "all" ? true : a.asset_type === filterType
  );

  const fogTabAvailable = currentScene !== null && currentScene.asset_type === "image";

  return (
    <div className="flex flex-col h-full">
      {/* Monitor + open/close controls */}
      <div className="px-3 py-2 border-b border-parchment-800 flex-shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <select
            value={selectedMonitor?.name ?? ""}
            onChange={(e) => {
              const m = monitors.find((mon) => mon.name === e.target.value);
              if (m) setSelectedMonitor(m);
            }}
            className="flex-1 bg-parchment-800 border border-parchment-700 rounded px-2 py-1 text-xs text-vellum-100 focus:outline-none focus:border-gold-500 min-w-0"
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
              className="flex-shrink-0 bg-gold-600 hover:bg-gold-500 disabled:opacity-50 text-parchment-950 px-2 py-1 rounded text-xs font-medium transition-colors"
              title="Abrí la ventana de proyección en el monitor seleccionado"
            >
              🖥 Abrir
            </button>
          ) : (
            <button
              onClick={handleCloseDisplay}
              className="flex-shrink-0 bg-parchment-700 hover:bg-parchment-600 text-vellum-200 px-2 py-1 rounded text-xs transition-colors"
            >
              Cerrar
            </button>
          )}
        </div>

        {displayOpen && (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-success-500 animate-pulse flex-shrink-0" />
            <span className="text-xs text-success-300 flex-1">Activa</span>
            {currentScene && (
              <span className="text-xs text-vellum-400 truncate max-w-[120px]">
                {currentScene.name}
              </span>
            )}
            <button
              onClick={handleClear}
              className="text-xs text-vellum-400 hover:text-vellum-100 transition-colors flex-shrink-0"
              title="Volver a la pantalla en negro"
            >
              Limpiar
            </button>
          </div>
        )}
      </div>

      {/* Tab bar: scenes / fog */}
      <div className="flex border-b border-parchment-800 flex-shrink-0">
        <button
          onClick={() => setRightTab("scenes")}
          className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 ${
            rightTab === "scenes"
              ? "border-gold-500 text-gold-400"
              : "border-transparent text-vellum-400 hover:text-vellum-100"
          }`}
        >
          🖼 Escenas
        </button>
        <button
          onClick={() => setRightTab("fog")}
          disabled={!fogTabAvailable}
          title={
            !fogTabAvailable
              ? "Proyectá una imagen primero para activar la niebla"
              : "Pintá la niebla de guerra sobre la imagen proyectada"
          }
          className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 disabled:opacity-40 disabled:cursor-not-allowed ${
            rightTab === "fog"
              ? "border-info-500 text-info-300"
              : "border-transparent text-vellum-400 hover:text-vellum-100"
          }`}
        >
          🌫 Niebla
        </button>
        {rightTab === "scenes" && (
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as typeof filterType)}
            className="bg-transparent border-l border-parchment-800 text-xs text-vellum-400 px-2 focus:outline-none"
            title="Filtrar el grid por tipo"
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
            <p className="text-vellum-400 text-xs text-center py-8 px-4">
              Abrí la pantalla primero con el botón 🖥 Abrir
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-vellum-400 text-xs text-center py-8 px-4">
              Sin imágenes ni videos en esta sesión. Importá assets desde la
              biblioteca para usarlos acá.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
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
      )}

      {/* Fog */}
      {rightTab === "fog" && fogTabAvailable && currentScene && (
        <div className="flex-1 min-h-0 p-2 flex flex-col">
          <FogPainter scene={currentScene} />
        </div>
      )}
    </div>
  );
}

interface CardProps {
  asset: Asset;
  isActive: boolean;
  onProject: () => void;
}

function DisplayAssetCard({ asset, isActive, onProject }: CardProps) {
  const thumb = asset.thumbnail_path ? convertFileSrc(asset.thumbnail_path) : null;

  return (
    <div
      onClick={onProject}
      className={`group rounded-lg border-2 cursor-pointer transition-all overflow-hidden hover:scale-[1.02] ${
        isActive
          ? "border-gold-500 ring-2 ring-gold-500/30"
          : "border-parchment-700 hover:border-parchment-500"
      }`}
      title={`Proyectar "${asset.name}"`}
    >
      <div className="aspect-video bg-parchment-900 flex items-center justify-center overflow-hidden">
        {thumb ? (
          <img src={thumb} alt={asset.name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-3xl">{asset.asset_type === "video" ? "🎬" : "🖼"}</span>
        )}
      </div>
      <div className="p-1.5 bg-parchment-800/60">
        <p className="text-[11px] text-vellum-200 truncate leading-tight" title={asset.name}>
          {asset.name}
        </p>
        {isActive && (
          <p className="text-[10px] text-gold-400 mt-0.5 leading-tight">▶ Proyectando</p>
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, useCallback } from "react";
import { emit } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  renderFog,
  type FogState,
  type FogStroke,
  type FogPoint,
} from "../lib/fogTypes";
import type { Asset } from "../lib/types";

interface Props {
  scene: Asset;
}

type BrushMode = "reveal" | "hide";

const BRUSH_PRESETS: { key: "sm" | "md" | "lg"; label: string; size: number }[] = [
  { key: "sm", label: "S", size: 0.04 },
  { key: "md", label: "M", size: 0.08 },
  { key: "lg", label: "L", size: 0.14 },
];

export default function FogPainter({ scene }: Props) {
  const [fogEnabled, setFogEnabled] = useState(false);
  const [brushMode, setBrushMode] = useState<BrushMode>("reveal");
  const [brushSize, setBrushSize] = useState(0.08);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fogStateRef = useRef<FogState>({ enabled: false, strokes: [] });
  const isDrawingRef = useRef(false);
  const currentStrokeRef = useRef<FogStroke | null>(null);

  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    renderFog(canvas, fogStateRef.current, container.clientWidth, container.clientHeight);
  }, []);

  const emitFog = useCallback(async () => {
    await emit("fog-update", fogStateRef.current);
  }, []);

  const updateFog = useCallback(
    (patch: Partial<FogState>) => {
      fogStateRef.current = { ...fogStateRef.current, ...patch };
      repaint();
      emitFog();
    },
    [repaint, emitFog]
  );

  // Sync enabled toggle
  useEffect(() => {
    updateFog({ enabled: fogEnabled });
  }, [fogEnabled]);

  const getPoint = (e: React.MouseEvent<HTMLCanvasElement>): FogPoint => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!fogEnabled) return;
    e.preventDefault();
    isDrawingRef.current = true;
    const pt = getPoint(e);
    currentStrokeRef.current = {
      type: brushMode,
      points: [pt],
      radius: brushSize,
    };
    const draft: FogState = {
      ...fogStateRef.current,
      strokes: [...fogStateRef.current.strokes, currentStrokeRef.current],
    };
    renderFog(canvasRef.current!, draft, containerRef.current!.clientWidth, containerRef.current!.clientHeight);
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });

    if (!isDrawingRef.current || !currentStrokeRef.current || !fogEnabled) return;
    const pt = getPoint(e);
    currentStrokeRef.current.points.push(pt);
    const draft: FogState = {
      ...fogStateRef.current,
      strokes: [...fogStateRef.current.strokes, currentStrokeRef.current],
    };
    renderFog(canvasRef.current!, draft, containerRef.current!.clientWidth, containerRef.current!.clientHeight);
    emit("fog-update", draft);
  };

  const onMouseUp = () => {
    if (!isDrawingRef.current || !currentStrokeRef.current) return;
    isDrawingRef.current = false;
    fogStateRef.current = {
      ...fogStateRef.current,
      strokes: [...fogStateRef.current.strokes, currentStrokeRef.current],
    };
    currentStrokeRef.current = null;
    emitFog();
  };

  const onMouseLeave = () => {
    onMouseUp();
    setCursorPos(null);
  };

  const handleFullFog = () => {
    updateFog({ strokes: [] });
  };

  const handleClearFog = () => {
    const fullReveal: FogStroke = {
      type: "reveal",
      points: [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
        { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }, { x: 1, y: 0.5 },
        { x: 0.5, y: 0.5 },
      ],
      radius: 1.5,
    };
    updateFog({ strokes: [fullReveal] });
  };

  const handleUndo = () => {
    const strokes = fogStateRef.current.strokes;
    if (strokes.length === 0) return;
    updateFog({ strokes: strokes.slice(0, -1) });
  };

  useEffect(() => {
    const observer = new ResizeObserver(() => repaint());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [repaint]);

  const src = convertFileSrc(scene.file_path);

  // Brush preview circle size in pixels (depends on container width)
  const containerWidth = containerRef.current?.clientWidth ?? 0;
  const previewRadiusPx = brushSize * containerWidth;

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Enable toggle */}
        <button
          onClick={() => setFogEnabled((v) => !v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            fogEnabled
              ? "bg-info-700 hover:bg-info-500 text-vellum-50"
              : "bg-parchment-700 hover:bg-parchment-600 text-vellum-200"
          }`}
        >
          {fogEnabled ? "🌫 Niebla ON" : "🌫 Niebla OFF"}
        </button>

        {fogEnabled && (
          <>
            {/* Brush mode */}
            <div className="flex rounded-lg overflow-hidden border border-parchment-700">
              <button
                onClick={() => setBrushMode("reveal")}
                title="Pintar para revelar zonas del mapa"
                className={`px-3 py-1.5 text-xs transition-colors ${
                  brushMode === "reveal"
                    ? "bg-gold-600 text-parchment-950"
                    : "bg-parchment-800 text-vellum-300 hover:text-vellum-100"
                }`}
              >
                ☀ Revelar
              </button>
              <button
                onClick={() => setBrushMode("hide")}
                title="Pintar para volver a cubrir zonas"
                className={`px-3 py-1.5 text-xs transition-colors ${
                  brushMode === "hide"
                    ? "bg-parchment-600 text-vellum-50"
                    : "bg-parchment-800 text-vellum-300 hover:text-vellum-100"
                }`}
              >
                🌑 Ocultar
              </button>
            </div>

            {/* Brush size — presets */}
            <div className="flex rounded-lg overflow-hidden border border-parchment-700">
              {BRUSH_PRESETS.map((p) => {
                const active = Math.abs(brushSize - p.size) < 0.005;
                return (
                  <button
                    key={p.key}
                    onClick={() => setBrushSize(p.size)}
                    title={`Pincel ${p.label}`}
                    className={`px-2.5 py-1.5 text-xs transition-colors min-w-[28px] ${
                      active
                        ? "bg-gold-600 text-parchment-950"
                        : "bg-parchment-800 text-vellum-300 hover:text-vellum-100"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            {/* Undo */}
            <button
              onClick={handleUndo}
              title="Deshacer último trazo"
              className="px-3 py-1.5 rounded-lg text-xs bg-parchment-700 hover:bg-parchment-600 text-vellum-200 transition-colors"
            >
              ↩ Deshacer
            </button>

            {/* Advanced toggle */}
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="ml-auto px-2 py-1 rounded text-xs text-vellum-400 hover:text-vellum-100 transition-colors"
            >
              {showAdvanced ? "▴" : "▾"} Más opciones
            </button>
          </>
        )}
      </div>

      {/* Advanced controls */}
      {fogEnabled && showAdvanced && (
        <div className="flex items-center gap-2 flex-wrap p-2 rounded-md bg-parchment-900/40 border border-parchment-800">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-vellum-300">Tamaño fino:</span>
            <input
              type="range"
              min="1"
              max="20"
              value={Math.round(brushSize * 100)}
              onChange={(e) => setBrushSize(Number(e.target.value) / 100)}
              className="w-24 accent-gold-500"
            />
            <span className="text-[10px] text-vellum-400 tabular-nums w-7 text-right">
              {Math.round(brushSize * 100)}
            </span>
          </div>
          <button
            onClick={handleClearFog}
            title="Revelar todo el mapa"
            className="px-2.5 py-1 rounded text-[11px] bg-parchment-800 hover:bg-parchment-700 text-vellum-200 transition-colors"
          >
            ☀ Todo visible
          </button>
          <button
            onClick={handleFullFog}
            title="Cubrir todo con niebla"
            className="px-2.5 py-1 rounded text-[11px] bg-parchment-800 hover:bg-parchment-700 text-vellum-200 transition-colors"
          >
            🌑 Todo oculto
          </button>
        </div>
      )}

      {/* Map canvas */}
      <div
        ref={containerRef}
        className="relative flex-1 rounded-xl overflow-hidden bg-parchment-900 select-none min-h-0"
        style={{ cursor: fogEnabled ? "none" : "default" }}
      >
        <img
          src={src}
          alt={scene.name}
          className="absolute inset-0 w-full h-full object-contain"
          draggable={false}
        />

        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={{ width: "100%", height: "100%" }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
        />

        {/* Brush size preview */}
        {fogEnabled && cursorPos && previewRadiusPx > 0 && (
          <div
            className="absolute pointer-events-none rounded-full border-2"
            style={{
              left: cursorPos.x - previewRadiusPx,
              top: cursorPos.y - previewRadiusPx,
              width: previewRadiusPx * 2,
              height: previewRadiusPx * 2,
              borderColor:
                brushMode === "reveal" ? "rgba(212,167,84,0.85)" : "rgba(248,241,222,0.7)",
              backgroundColor:
                brushMode === "reveal"
                  ? "rgba(212,167,84,0.10)"
                  : "rgba(0,0,0,0.18)",
            }}
          />
        )}

        {!fogEnabled && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-vellum-300 text-sm bg-parchment-950/80 px-3 py-1.5 rounded-full border border-parchment-700">
              Activá la niebla para pintar
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

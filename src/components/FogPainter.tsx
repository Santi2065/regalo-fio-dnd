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

export default function FogPainter({ scene }: Props) {
  const [fogEnabled, setFogEnabled] = useState(false);
  const [brushMode, setBrushMode] = useState<BrushMode>("reveal");
  const [brushSize, setBrushSize] = useState(0.06); // normalized radius

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
    // Immediately render the first circle
    const draft: FogState = {
      ...fogStateRef.current,
      strokes: [...fogStateRef.current.strokes, currentStrokeRef.current],
    };
    renderFog(canvasRef.current!, draft, containerRef.current!.clientWidth, containerRef.current!.clientHeight);
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !currentStrokeRef.current || !fogEnabled) return;
    const pt = getPoint(e);
    currentStrokeRef.current.points.push(pt);
    const draft: FogState = {
      ...fogStateRef.current,
      strokes: [...fogStateRef.current.strokes, currentStrokeRef.current],
    };
    renderFog(canvasRef.current!, draft, containerRef.current!.clientWidth, containerRef.current!.clientHeight);
    // Throttled emit during drag
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

  const handleFullFog = () => {
    // Replace all strokes with a single full-coverage "full fog" sentinel
    updateFog({ strokes: [] });
    // Already covered by "enabled: true" + empty strokes = all black
  };

  const handleClearFog = () => {
    // One giant reveal stroke covering the whole canvas
    const fullReveal: FogStroke = {
      type: "reveal",
      points: [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
        { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }, { x: 1, y: 0.5 },
        { x: 0.5, y: 0.5 },
      ],
      radius: 1.5, // large enough to cover everything
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

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Enable toggle */}
        <button
          onClick={() => setFogEnabled((v) => !v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            fogEnabled
              ? "bg-indigo-700 hover:bg-indigo-600 text-white"
              : "bg-stone-700 hover:bg-stone-600 text-stone-300"
          }`}
        >
          {fogEnabled ? "🌫 Niebla ON" : "🌫 Niebla OFF"}
        </button>

        {fogEnabled && (
          <>
            {/* Brush mode */}
            <div className="flex rounded-lg overflow-hidden border border-stone-700">
              <button
                onClick={() => setBrushMode("reveal")}
                className={`px-3 py-1.5 text-xs transition-colors ${
                  brushMode === "reveal"
                    ? "bg-amber-700 text-white"
                    : "bg-stone-800 text-stone-400 hover:text-stone-200"
                }`}
              >
                ☀ Revelar
              </button>
              <button
                onClick={() => setBrushMode("hide")}
                className={`px-3 py-1.5 text-xs transition-colors ${
                  brushMode === "hide"
                    ? "bg-stone-600 text-white"
                    : "bg-stone-800 text-stone-400 hover:text-stone-200"
                }`}
              >
                🌑 Ocultar
              </button>
            </div>

            {/* Brush size */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-stone-500">Pincel:</span>
              <input
                type="range"
                min="1"
                max="15"
                value={Math.round(brushSize * 100)}
                onChange={(e) => setBrushSize(Number(e.target.value) / 100)}
                className="w-20 accent-amber-500"
              />
            </div>

            {/* Actions */}
            <button
              onClick={handleClearFog}
              title="Revelar todo el mapa"
              className="px-3 py-1.5 rounded-lg text-xs bg-stone-700 hover:bg-stone-600 text-stone-300 transition-colors"
            >
              ☀ Todo visible
            </button>
            <button
              onClick={handleFullFog}
              title="Cubrir todo con niebla"
              className="px-3 py-1.5 rounded-lg text-xs bg-stone-700 hover:bg-stone-600 text-stone-300 transition-colors"
            >
              🌑 Todo oculto
            </button>
            <button
              onClick={handleUndo}
              title="Deshacer último trazo"
              className="px-3 py-1.5 rounded-lg text-xs bg-stone-700 hover:bg-stone-600 text-stone-300 transition-colors"
            >
              ↩ Deshacer
            </button>
          </>
        )}
      </div>

      {/* Map canvas */}
      <div
        ref={containerRef}
        className="relative flex-1 rounded-xl overflow-hidden bg-stone-900 select-none min-h-0"
        style={{ cursor: fogEnabled ? (brushMode === "reveal" ? "crosshair" : "cell") : "default" }}
      >
        {/* Background image */}
        <img
          src={src}
          alt={scene.name}
          className="absolute inset-0 w-full h-full object-contain"
          draggable={false}
        />

        {/* Fog canvas overlay */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={{ width: "100%", height: "100%" }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />

        {!fogEnabled && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-stone-600 text-sm bg-stone-950/70 px-3 py-1 rounded-full">
              Activá la niebla para pintar
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { renderFog, type FogState, INITIAL_FOG_STATE } from "../lib/fogTypes";

interface Scene {
  file_path: string;
  asset_type: string;
  title?: string;
}

export default function PlayerDisplay() {
  const [scene, setScene] = useState<Scene | null>(null);
  const [fading, setFading] = useState(false);
  const fogCanvasRef = useRef<HTMLCanvasElement>(null);
  const fogStateRef = useRef<FogState>(INITIAL_FOG_STATE);
  const containerRef = useRef<HTMLDivElement>(null);

  const paintFog = () => {
    const canvas = fogCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    renderFog(canvas, fogStateRef.current, container.clientWidth, container.clientHeight);
  };

  useEffect(() => {
    const unlistens: Promise<() => void>[] = [];

    unlistens.push(
      listen<Scene>("scene-change", (event) => {
        setFading(true);
        setTimeout(() => {
          setScene(event.payload);
          setFading(false);
        }, 400);
      })
    );

    unlistens.push(
      listen("scene-clear", () => {
        setFading(true);
        setTimeout(() => {
          setScene(null);
          setFading(false);
        }, 400);
      })
    );

    unlistens.push(
      listen<FogState>("fog-update", (event) => {
        fogStateRef.current = event.payload;
        paintFog();
      })
    );

    return () => {
      unlistens.forEach((u) => u.then((fn) => fn()));
    };
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(() => paintFog());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const src = scene ? convertFileSrc(scene.file_path) : null;

  return (
    <div
      ref={containerRef}
      className="w-screen h-screen bg-black flex items-center justify-center overflow-hidden relative"
      style={{ cursor: "none" }}
    >
      {/* Scene content */}
      <div
        className="absolute inset-0 flex items-center justify-center transition-opacity duration-400"
        style={{ opacity: fading ? 0 : 1 }}
      >
        {src && scene?.asset_type === "image" && (
          <img
            src={src}
            alt={scene.title ?? ""}
            className="max-w-full max-h-full object-contain"
          />
        )}
        {src && scene?.asset_type === "video" && (
          <video
            src={src}
            autoPlay
            loop
            muted={false}
            className="max-w-full max-h-full object-contain"
          />
        )}
        {!scene && (
          <div className="text-stone-800 text-center select-none">
            <div className="text-8xl mb-4 opacity-30">⚔</div>
            <p className="text-xl opacity-20 tracking-widest uppercase font-light">
              DnD Orchestrator
            </p>
          </div>
        )}
      </div>

      {/* Fog of War canvas overlay */}
      <canvas
        ref={fogCanvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ width: "100%", height: "100%" }}
      />

      {/* Title overlay */}
      {scene?.title && !fading && (
        <div className="absolute bottom-8 left-0 right-0 text-center px-8 z-10">
          <span className="bg-black/60 text-white text-lg px-6 py-2 rounded-full backdrop-blur-sm">
            {scene.title}
          </span>
        </div>
      )}
    </div>
  );
}

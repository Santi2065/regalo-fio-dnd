import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";

interface Scene {
  file_path: string;
  asset_type: string;
  title?: string;
}

export default function PlayerDisplay() {
  const [scene, setScene] = useState<Scene | null>(null);
  const [fading, setFading] = useState(false);

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

    return () => {
      unlistens.forEach((u) => u.then((fn) => fn()));
    };
  }, []);

  const displayScene = scene;
  const src = displayScene ? convertFileSrc(displayScene.file_path) : null;

  return (
    <div
      className="w-screen h-screen bg-black flex items-center justify-center overflow-hidden relative"
      style={{ cursor: "none" }}
    >
      {/* Scene content */}
      <div
        className="absolute inset-0 flex items-center justify-center transition-opacity duration-400"
        style={{ opacity: fading ? 0 : 1 }}
      >
        {src && displayScene?.asset_type === "image" && (
          <img
            src={src}
            alt={displayScene.title ?? ""}
            className="max-w-full max-h-full object-contain"
          />
        )}
        {src && displayScene?.asset_type === "video" && (
          <video
            src={src}
            autoPlay
            loop
            muted={false}
            className="max-w-full max-h-full object-contain"
          />
        )}
        {!displayScene && (
          <div className="text-stone-800 text-center select-none">
            <div className="text-8xl mb-4 opacity-30">⚔</div>
            <p className="text-xl opacity-20 tracking-widest uppercase font-light">
              DnD Orchestrator
            </p>
          </div>
        )}
      </div>

      {/* Title overlay */}
      {displayScene?.title && !fading && (
        <div className="absolute bottom-8 left-0 right-0 text-center px-8">
          <span className="bg-black/60 text-white text-lg px-6 py-2 rounded-full backdrop-blur-sm">
            {displayScene.title}
          </span>
        </div>
      )}
    </div>
  );
}

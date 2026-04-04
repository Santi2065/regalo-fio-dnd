import type { Asset } from "../lib/types";
import { convertFileSrc } from "@tauri-apps/api/core";

interface Props {
  asset: Asset;
  selected: boolean;
  onClick: () => void;
  onDelete: () => void;
}

const TYPE_ICONS: Record<string, string> = {
  image: "🖼",
  audio: "🔊",
  document: "📄",
  video: "🎬",
  map: "🗺",
  character_sheet: "📋",
};

export default function AssetCard({ asset, selected, onClick, onDelete }: Props) {
  const icon = TYPE_ICONS[asset.asset_type] ?? "📁";
  const thumbSrc = asset.thumbnail_path ? convertFileSrc(asset.thumbnail_path) : null;

  return (
    <div
      onClick={onClick}
      className={`group relative rounded-xl border cursor-pointer transition-all overflow-hidden ${
        selected
          ? "border-amber-500 bg-stone-800"
          : "border-stone-700 bg-stone-800/50 hover:border-stone-500 hover:bg-stone-800"
      }`}
    >
      {/* Thumbnail / icon area */}
      <div className="aspect-square flex items-center justify-center bg-stone-900 overflow-hidden">
        {thumbSrc ? (
          <img
            src={thumbSrc}
            alt={asset.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-3xl">{icon}</span>
        )}
      </div>

      {/* Name */}
      <div className="p-2">
        <p className="text-xs text-stone-300 truncate" title={asset.name}>
          {asset.name}
        </p>
        {asset.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {asset.tags.slice(0, 2).map((tag) => (
              <span key={tag} className="text-xs bg-stone-700 text-stone-400 px-1.5 py-0.5 rounded">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Delete button */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute top-1 right-1 bg-red-900/80 hover:bg-red-700 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        title="Eliminar"
      >
        ×
      </button>
    </div>
  );
}

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Asset } from "../lib/types";

interface Props {
  asset: Asset;
  onClose: () => void;
  onDelete: () => void;
  onUpdate: (updated: Asset) => void;
}

export default function AssetPreview({ asset, onClose, onDelete, onUpdate }: Props) {
  const [editName, setEditName] = useState(asset.name);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(asset.tags);
  const [saving, setSaving] = useState(false);

  const fileSrc = convertFileSrc(asset.file_path);

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke("update_asset", { id: asset.id, name: editName, tags });
      onUpdate({ ...asset, name: editName, tags });
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) {
      setTags((prev) => [...prev, t]);
    }
    setTagInput("");
  };

  const removeTag = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag));

  const isDirty = editName !== asset.name || JSON.stringify(tags) !== JSON.stringify(asset.tags);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
        <span className="text-sm font-medium text-stone-300">Detalle</span>
        <button
          onClick={onClose}
          className="text-stone-500 hover:text-stone-300 text-lg leading-none"
        >
          ×
        </button>
      </div>

      {/* Preview */}
      <div className="flex-shrink-0 bg-stone-950 flex items-center justify-center" style={{ height: "180px" }}>
        {asset.asset_type === "image" ? (
          <img
            src={fileSrc}
            alt={asset.name}
            className="max-h-full max-w-full object-contain"
          />
        ) : asset.asset_type === "audio" ? (
          <div className="w-full px-4">
            <div className="text-4xl text-center mb-3">🔊</div>
            <audio controls src={fileSrc} className="w-full" style={{ colorScheme: "dark" }} />
          </div>
        ) : asset.asset_type === "video" ? (
          <video controls src={fileSrc} className="max-h-full max-w-full" />
        ) : (
          <div className="text-5xl">
            {asset.asset_type === "document" ? "📄" : "📁"}
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Name */}
        <div>
          <label className="block text-xs text-stone-500 mb-1">Nombre</label>
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-1.5 text-sm text-stone-200 focus:outline-none focus:border-stone-500"
          />
        </div>

        {/* Type */}
        <div>
          <label className="block text-xs text-stone-500 mb-1">Tipo</label>
          <p className="text-sm text-stone-400 capitalize">{asset.asset_type}</p>
        </div>

        {/* Tags */}
        <div>
          <label className="block text-xs text-stone-500 mb-1">Tags</label>
          <div className="flex flex-wrap gap-1 mb-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1 bg-stone-700 text-stone-300 text-xs px-2 py-0.5 rounded"
              >
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="text-stone-500 hover:text-stone-200 leading-none"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); }}}
              placeholder="Agregar tag..."
              className="flex-1 bg-stone-800 border border-stone-700 rounded-lg px-2 py-1 text-xs text-stone-200 placeholder-stone-600 focus:outline-none focus:border-stone-500"
            />
            <button
              onClick={addTag}
              className="bg-stone-700 hover:bg-stone-600 text-stone-300 px-2 py-1 rounded-lg text-xs"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-stone-800 space-y-2">
        {isDirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        )}
        <button
          onClick={onDelete}
          className="w-full bg-stone-800 hover:bg-red-900 text-stone-400 hover:text-red-300 py-1.5 rounded-lg text-sm transition-colors"
        >
          Eliminar asset
        </button>
      </div>
    </div>
  );
}

import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Asset } from "../lib/types";

interface SoundboardSlot {
  id: string;
  session_id: string;
  slot_position: number;
  asset_id: string;
  label: string | null;
  volume: number;
  loop_enabled: boolean;
  hotkey: string | null;
  color: string | null;
  file_path: string | null;
  asset_name: string | null;
}

interface Props {
  sessionId: string;
}

const SLOT_COLORS = [
  "#b45309", "#15803d", "#1d4ed8", "#7e22ce",
  "#be185d", "#0f766e", "#b91c1c", "#4338ca",
];

const GRID_SIZE = 16;

export default function SoundboardPanel({ sessionId }: Props) {
  const [slots, setSlots] = useState<(SoundboardSlot | null)[]>(
    Array(GRID_SIZE).fill(null)
  );
  const [audioAssets, setAudioAssets] = useState<Asset[]>([]);
  const [playing, setPlaying] = useState<Set<string>>(new Set());
  const [ambient, setAmbient] = useState<Map<string, string>>(new Map()); // slotId -> channel
  const [editingSlot, setEditingSlot] = useState<SoundboardSlot | null>(null);
  const [masterVolume, setMasterVolume] = useState(1.0);
  const [dragOverPos, setDragOverPos] = useState<number | null>(null);

  const loadSlots = useCallback(async () => {
    const data = await invoke<SoundboardSlot[]>("get_soundboard", { sessionId });
    const grid: (SoundboardSlot | null)[] = Array(GRID_SIZE).fill(null);
    for (const slot of data) {
      if (slot.slot_position < GRID_SIZE) {
        grid[slot.slot_position] = slot;
      }
    }
    setSlots(grid);
  }, [sessionId]);

  useEffect(() => {
    loadSlots();
    // Load audio from both this session and the global library
    Promise.all([
      invoke<Asset[]>("get_assets", { sessionId, assetTypeFilter: "audio" }),
      invoke<Asset[]>("get_assets", { sessionId: null, assetTypeFilter: "audio" }),
    ]).then(([sess, global]) => {
      // Merge, deduplicating by id
      const seen = new Set<string>();
      const all: Asset[] = [];
      for (const a of [...sess, ...global]) {
        if (!seen.has(a.id)) { seen.add(a.id); all.push(a); }
      }
      setAudioAssets(all);
    });
  }, [sessionId]);

  const handleTrigger = async (slot: SoundboardSlot, _position: number) => {
    if (!slot.file_path) return;

    const vol = slot.volume * masterVolume;

    if (slot.loop_enabled) {
      // Toggle ambient
      const channel = `ambient-${slot.id}`;
      if (ambient.has(slot.id)) {
        await invoke("stop_ambient", { channel });
        setAmbient((prev) => {
          const next = new Map(prev);
          next.delete(slot.id);
          return next;
        });
      } else {
        await invoke("play_ambient", { channel, filePath: slot.file_path, volume: vol });
        setAmbient((prev) => new Map(prev).set(slot.id, channel));
      }
    } else {
      // One-shot SFX
      setPlaying((prev) => new Set(prev).add(slot.id));
      try {
        await invoke("play_sfx", { filePath: slot.file_path, volume: vol });
      } finally {
        setTimeout(
          () => setPlaying((prev) => { const n = new Set(prev); n.delete(slot.id); return n; }),
          500
        );
      }
    }
  };

  const handleDrop = async (position: number, asset: Asset) => {
    setDragOverPos(null);
    const existing = slots[position];

    // Remove existing slot at this position if any
    if (existing) {
      await invoke("remove_soundboard_slot", { id: existing.id });
    }

    const slot = await invoke<SoundboardSlot>("add_soundboard_slot", {
      sessionId,
      slotPosition: position,
      assetId: asset.id,
      label: asset.name.replace(/\.[^.]+$/, ""),
      volume: 1.0,
      loopEnabled: false,
      color: SLOT_COLORS[position % SLOT_COLORS.length],
    });

    setSlots((prev) => {
      const next = [...prev];
      next[position] = slot;
      return next;
    });
  };

  const handleRemoveSlot = async (slot: SoundboardSlot, position: number) => {
    if (ambient.has(slot.id)) {
      await invoke("stop_ambient", { channel: `ambient-${slot.id}` });
      setAmbient((prev) => { const n = new Map(prev); n.delete(slot.id); return n; });
    }
    await invoke("remove_soundboard_slot", { id: slot.id });
    setSlots((prev) => {
      const next = [...prev];
      next[position] = null;
      return next;
    });
  };

  // ── Global hotkey listener ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) return;

      const key = e.key.toLowerCase();
      for (const slot of slots) {
        if (slot && slot.hotkey && slot.hotkey.toLowerCase() === key) {
          e.preventDefault();
          handleTrigger(slot, slot.slot_position);
          return;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [slots, handleTrigger]);

  const handleSaveEdit = async () => {
    if (!editingSlot) return;
    await invoke("update_soundboard_slot", {
      id: editingSlot.id,
      label: editingSlot.label,
      volume: editingSlot.volume,
      loopEnabled: editingSlot.loop_enabled,
      hotkey: editingSlot.hotkey,
      color: editingSlot.color,
    });
    setSlots((prev) =>
      prev.map((s) => (s?.id === editingSlot.id ? editingSlot : s))
    );
    setEditingSlot(null);
  };

  const stopAll = async () => {
    await invoke("stop_all_audio");
    setAmbient(new Map());
    setPlaying(new Set());
  };

  return (
    <div className="flex h-full">
      {/* Main soundboard */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-4 px-6 py-3 border-b border-stone-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-stone-400 text-sm">Volumen master</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={masterVolume}
              onChange={(e) => setMasterVolume(Number(e.target.value))}
              className="w-28 accent-amber-500"
            />
            <span className="text-stone-400 text-xs w-8">
              {Math.round(masterVolume * 100)}%
            </span>
          </div>

          <button
            onClick={stopAll}
            className="ml-auto bg-red-900 hover:bg-red-800 text-red-200 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            ⏹ Stop todo
          </button>
        </div>

        {/* Instructions */}
        <div className="px-6 py-2 text-xs text-stone-600 border-b border-stone-800/50 flex-shrink-0">
          Arrastrá un audio a una celda · Click = disparar · Click derecho = editar · Hotkeys activos en cualquier pestaña
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-4 gap-3">
            {slots.map((slot, i) => (
              <SoundboardCell
                key={i}
                position={i}
                slot={slot}
                isPlaying={slot ? playing.has(slot.id) : false}
                isAmbient={slot ? ambient.has(slot.id) : false}
                isDragOver={dragOverPos === i}
                onTrigger={() => slot && handleTrigger(slot, i)}
                onRemove={() => slot && handleRemoveSlot(slot, i)}
                onEdit={() => slot && setEditingSlot({ ...slot })}
                onDragOver={() => setDragOverPos(i)}
                onDragLeave={() => setDragOverPos(null)}
                onDrop={(asset) => handleDrop(i, asset)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Audio asset list */}
      <div className="w-56 flex-shrink-0 border-l border-stone-800 flex flex-col bg-stone-900/30">
        <div className="px-4 py-3 border-b border-stone-800">
          <p className="text-sm font-medium text-stone-400">Audio assets</p>
          <p className="text-xs text-stone-600 mt-0.5">Arrastrá a una celda</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {audioAssets.length === 0 ? (
            <p className="text-stone-600 text-xs p-4 text-center">
              Sin audio. Importá archivos desde la pestaña Assets.
            </p>
          ) : (
            audioAssets.map((asset) => (
              <AudioAssetRow key={asset.id} asset={asset} />
            ))
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editingSlot && (
        <EditModal
          slot={editingSlot}
          onChange={setEditingSlot}
          onSave={handleSaveEdit}
          onCancel={() => setEditingSlot(null)}
        />
      )}
    </div>
  );
}

// Extracted to avoid hook-in-conditional issue
function EditModal({
  slot: editingSlot,
  onChange: setEditingSlot,
  onSave: handleSaveEdit,
  onCancel,
}: {
  slot: SoundboardSlot;
  onChange: (s: SoundboardSlot) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [capturingKey, setCapturingKey] = useState(false);

  useEffect(() => {
    if (!capturingKey) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === "Escape") {
        setCapturingKey(false);
        return;
      }
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      setEditingSlot({ ...editingSlot, hotkey: key });
      setCapturingKey(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [capturingKey, editingSlot]);

  return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-stone-900 border border-stone-700 rounded-xl p-6 w-80">
            <h3 className="font-semibold text-stone-100 mb-4">Editar slot</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-stone-500 mb-1">Label</label>
                <input
                  value={editingSlot.label ?? ""}
                  onChange={(e) => setEditingSlot({ ...editingSlot, label: e.target.value })}
                  className="w-full bg-stone-800 border border-stone-600 rounded px-3 py-1.5 text-sm text-stone-200 focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">
                  Volumen ({Math.round(editingSlot.volume * 100)}%)
                </label>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={editingSlot.volume}
                  onChange={(e) => setEditingSlot({ ...editingSlot, volume: Number(e.target.value) })}
                  className="w-full accent-amber-500"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingSlot.loop_enabled}
                  onChange={(e) => setEditingSlot({ ...editingSlot, loop_enabled: e.target.checked })}
                  className="rounded accent-amber-500"
                />
                <span className="text-sm text-stone-300">Loop (ambient)</span>
              </label>
              <div>
                <label className="block text-xs text-stone-500 mb-1">Hotkey</label>
                <div className="flex items-center gap-2">
                  {editingSlot.hotkey ? (
                    <kbd className="bg-stone-700 text-stone-200 text-xs px-2 py-1 rounded border border-stone-500 font-mono">
                      {editingSlot.hotkey}
                    </kbd>
                  ) : (
                    <span className="text-xs text-stone-600">Sin asignar</span>
                  )}
                  <button
                    onClick={() => setCapturingKey(true)}
                    className={`px-2 py-1 rounded text-xs transition-colors ${
                      capturingKey
                        ? "bg-amber-700 text-white animate-pulse"
                        : "bg-stone-700 hover:bg-stone-600 text-stone-300"
                    }`}
                  >
                    {capturingKey ? "Presioná una tecla..." : "Asignar tecla"}
                  </button>
                  {editingSlot.hotkey && (
                    <button
                      onClick={() => setEditingSlot({ ...editingSlot, hotkey: null })}
                      className="text-xs text-stone-600 hover:text-red-400 transition-colors"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {SLOT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setEditingSlot({ ...editingSlot, color: c })}
                      className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                      style={{
                        backgroundColor: c,
                        borderColor: editingSlot.color === c ? "white" : "transparent",
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={handleSaveEdit}
                className="flex-1 bg-amber-700 hover:bg-amber-600 text-white py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Guardar
              </button>
              <button
                onClick={onCancel}
                className="flex-1 bg-stone-700 hover:bg-stone-600 text-stone-300 py-2 rounded-lg text-sm transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

interface CellProps {
  position: number;
  slot: SoundboardSlot | null;
  isPlaying: boolean;
  isAmbient: boolean;
  isDragOver: boolean;
  onTrigger: () => void;
  onRemove: () => void;
  onEdit: () => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: (asset: Asset) => void;
}

function SoundboardCell({
  slot,
  isPlaying,
  isAmbient,
  isDragOver,
  onTrigger,
  onRemove,
  onEdit,
  onDragOver,
  onDragLeave,
  onDrop,
}: CellProps) {
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    onDragOver();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const data = e.dataTransfer.getData("application/dnd-asset");
    if (data) {
      const asset: Asset = JSON.parse(data);
      if (asset.asset_type === "audio") {
        onDrop(asset);
      }
    }
  };

  const bgColor = slot?.color ?? "#292524";

  return (
    <div
      className={`relative rounded-xl border-2 aspect-square flex flex-col items-center justify-center p-3 transition-all select-none
        ${isDragOver ? "border-amber-400 scale-105" : slot ? "border-transparent" : "border-stone-700 border-dashed"}
        ${slot ? "cursor-pointer hover:brightness-110 active:scale-95" : "cursor-default"}
        ${isPlaying ? "ring-2 ring-white/60 scale-95" : ""}
        ${isAmbient ? "ring-2 ring-green-400/60" : ""}
      `}
      style={{ backgroundColor: slot ? bgColor + "33" : undefined, borderColor: slot ? bgColor : undefined }}
      onClick={onTrigger}
      onContextMenu={(e) => { e.preventDefault(); if (slot) onEdit(); }}
      onDragOver={handleDragOver}
      onDragLeave={onDragLeave}
      onDrop={handleDrop}
    >
      {slot ? (
        <>
          <div className="text-2xl mb-1">
            {isAmbient ? "🎵" : slot.loop_enabled ? "🔁" : "🔊"}
          </div>
          <p className="text-xs text-center text-stone-200 font-medium leading-tight truncate w-full text-center">
            {slot.label ?? slot.asset_name ?? "—"}
          </p>
          {slot.loop_enabled && (
            <span className="text-xs text-stone-500 mt-0.5">
              {isAmbient ? "▶ playing" : "loop"}
            </span>
          )}
          {slot.hotkey && (
            <kbd className="absolute bottom-1 right-1 bg-black/40 text-stone-400 text-[9px] px-1 rounded font-mono leading-tight">
              {slot.hotkey}
            </kbd>
          )}

          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="absolute top-1 right-1 text-stone-600 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 flex items-center justify-center"
          >
            ×
          </button>
        </>
      ) : (
        <div className="text-stone-700 text-2xl">+</div>
      )}
    </div>
  );
}

function AudioAssetRow({ asset }: { asset: Asset }) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/dnd-asset", JSON.stringify(asset));
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="flex items-center gap-2 px-4 py-2.5 border-b border-stone-800/50 cursor-grab hover:bg-stone-800/40 transition-colors"
    >
      <span className="text-base">🔊</span>
      <p className="text-xs text-stone-300 truncate flex-1" title={asset.name}>
        {asset.name}
      </p>
    </div>
  );
}

import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Asset } from "../lib/types";
import { toast } from "../lib/toast";
import {
  parseGuion,
  buildCueToken,
  CUE_META,
  type CueType,
  type Cue,
} from "../lib/guionParser";

interface Props {
  sessionId: string;
  mode: "prep" | "live";
}

export default function GuionEditor({ sessionId, mode }: Props) {
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // ── Load guion + assets ───────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      invoke<{ content: string }>("get_guion", { sessionId }),
      invoke<Asset[]>("get_assets", { sessionId, assetTypeFilter: null }),
    ])
      .then(([guion, allAssets]) => {
        setContent(guion.content);
        setSavedContent(guion.content);
        setAssets(allAssets);
        setLoading(false);
      })
      .catch((e) => {
        console.error("[GuionEditor] load failed", e);
        toast.error("No se pudo cargar el guión");
        setLoading(false);
      });
  }, [sessionId]);

  const handleSave = useCallback(
    async (opts?: { silent?: boolean }) => {
      setSaving(true);
      try {
        await invoke("save_guion", { sessionId, content });
        setSavedContent(content);
        if (!opts?.silent) toast.success("Guión guardado");
      } catch (e) {
        console.error("[GuionEditor] save failed", e);
        toast.error("No se pudo guardar el guión");
      } finally {
        setSaving(false);
      }
    },
    [sessionId, content]
  );

  // Auto-save Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s" && mode === "prep") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave, mode]);

  // Auto-save when switching to live
  useEffect(() => {
    if (mode === "live" && content !== savedContent) {
      handleSave({ silent: true });
    }
  }, [mode]);

  const isDirty = content !== savedContent;

  // ── Drag-and-drop cue insertion ───────────────────────────────────────────
  const handleDropOnEditor = (e: React.DragEvent) => {
    e.preventDefault();
    const data = e.dataTransfer.getData("application/dnd-asset");
    if (!data) return;
    const asset: Asset = JSON.parse(data);

    const cueType: CueType =
      asset.asset_type === "image" || asset.asset_type === "video"
        ? "project"
        : asset.asset_type === "audio"
        ? "sfx"
        : "sfx";

    const token = buildCueToken(cueType, asset.id, asset.name.replace(/\.[^.]+$/, ""));
    insertAtCursor(token);
  };

  const insertAtCursor = (text: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setContent((c) => c + " " + text);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = content.slice(0, start);
    const after = content.slice(end);
    const newContent = before + " " + text + " " + after;
    setContent(newContent);
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = start + text.length + 2;
      ta.focus();
    }, 0);
  };

  const insertCue = (asset: Asset, type: CueType) => {
    const token = buildCueToken(type, asset.id, asset.name.replace(/\.[^.]+$/, ""));
    insertAtCursor(token);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-stone-500">
        Cargando guión...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-stone-800 flex-shrink-0 bg-stone-900/40">
        {mode === "prep" && (
          <>
            <span className="text-xs text-stone-600">
              Arrastrá assets desde la derecha · Ctrl+S para guardar
            </span>
            <div className="ml-auto flex items-center gap-2">
              {isDirty && (
                <span className="text-xs text-amber-500">Sin guardar</span>
              )}
              <button
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-white px-3 py-1 rounded text-xs font-medium transition-colors"
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </>
        )}

        {mode === "live" && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => invoke("stop_all_audio")}
              className="bg-red-900 hover:bg-red-800 text-red-200 px-3 py-1 rounded text-xs font-medium transition-colors"
            >
              ⏹ Stop todo
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex">
        {mode === "prep" ? (
          <PrepMode
            content={content}
            onChange={setContent}
            assets={assets}
            textareaRef={textareaRef}
            onDropOnEditor={handleDropOnEditor}
            onInsertCue={insertCue}
          />
        ) : (
          <LiveMode
            content={content}
            assets={assets}
          />
        )}
      </div>
    </div>
  );
}

// ── PREP MODE ─────────────────────────────────────────────────────────────────

interface PrepProps {
  content: string;
  onChange: (c: string) => void;
  assets: Asset[];
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onDropOnEditor: (e: React.DragEvent) => void;
  onInsertCue: (asset: Asset, type: CueType) => void;
}

function PrepMode({ content, onChange, assets, textareaRef, onDropOnEditor, onInsertCue }: PrepProps) {
  const [dragOver, setDragOver] = useState(false);
  const audioAssets = assets.filter((a) => a.asset_type === "audio");
  const visualAssets = assets.filter(
    (a) => a.asset_type === "image" || a.asset_type === "video"
  );

  return (
    <div className="flex flex-1 min-w-0 min-h-0">
      {/* Editor */}
      <div className="flex-1 relative min-w-0">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => onChange(e.target.value)}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { setDragOver(false); onDropOnEditor(e); }}
          placeholder={`# Escena 1: El Comienzo\n\nEscribí el guión de tu sesión aquí...\n\nArrastrá assets desde el panel derecho para insertar cues de audio o proyección. Los cues se ven así:\n%%sfx:id:Vaso roto%%  %%ambient:id:Taberna%%  %%project:id:Mapa%%`}
          spellCheck={false}
          className={`w-full h-full bg-transparent text-stone-200 text-sm font-mono resize-none focus:outline-none px-8 py-6 leading-relaxed placeholder-stone-700 transition-colors ${
            dragOver ? "bg-amber-900/10" : ""
          }`}
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              e.preventDefault();
              const start = e.currentTarget.selectionStart;
              const end = e.currentTarget.selectionEnd;
              const before = content.slice(0, start);
              const after = content.slice(end);
              onChange(before + "  " + after);
              setTimeout(() => {
                if (textareaRef.current) {
                  textareaRef.current.selectionStart =
                    textareaRef.current.selectionEnd = start + 2;
                }
              }, 0);
            }
          }}
        />
        {dragOver && (
          <div className="absolute inset-0 border-2 border-dashed border-amber-600 rounded pointer-events-none flex items-center justify-center">
            <span className="bg-stone-900/80 text-amber-400 text-sm px-4 py-2 rounded-lg">
              Soltá para insertar cue
            </span>
          </div>
        )}
      </div>

      {/* Asset sidebar */}
      <div className="w-56 flex-shrink-0 border-l border-stone-800 flex flex-col bg-stone-900/30 overflow-y-auto">
        <div className="px-3 py-2 border-b border-stone-800 sticky top-0 bg-stone-900/90">
          <p className="text-xs font-medium text-stone-400">Assets</p>
          <p className="text-xs text-stone-600 mt-0.5">Arrastrá para insertar cue</p>
        </div>

        {audioAssets.length > 0 && (
          <div>
            <p className="px-3 pt-3 pb-1 text-xs text-stone-600 uppercase tracking-wider">Audio</p>
            {audioAssets.map((asset) => (
              <PrepAssetRow
                key={asset.id}
                asset={asset}
                defaultCueType="sfx"
                onInsert={onInsertCue}
              />
            ))}
          </div>
        )}

        {visualAssets.length > 0 && (
          <div>
            <p className="px-3 pt-3 pb-1 text-xs text-stone-600 uppercase tracking-wider">Imágenes / Video</p>
            {visualAssets.map((asset) => (
              <PrepAssetRow
                key={asset.id}
                asset={asset}
                defaultCueType="project"
                onInsert={onInsertCue}
              />
            ))}
          </div>
        )}

        {assets.length === 0 && (
          <p className="text-stone-600 text-xs p-4 text-center">
            Sin assets. Importá archivos desde la pestaña Assets.
          </p>
        )}

        {/* Cue legend */}
        <div className="mt-auto border-t border-stone-800 px-3 py-3 space-y-1.5">
          <p className="text-xs text-stone-600 mb-2">Tipos de cue:</p>
          {(["sfx", "ambient", "project"] as CueType[]).map((t) => (
            <div key={t} className="flex items-center gap-2">
              <span className="text-xs">{CUE_META[t].icon}</span>
              <span className="text-xs text-stone-500">
                <code className="text-stone-600">%%{t}:id:label%%</code>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface PrepAssetRowProps {
  asset: Asset;
  defaultCueType: CueType;
  onInsert: (asset: Asset, type: CueType) => void;
}

function PrepAssetRow({ asset, defaultCueType, onInsert }: PrepAssetRowProps) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/dnd-asset", JSON.stringify(asset));
    e.dataTransfer.effectAllowed = "copy";
  };

  const thumb = asset.thumbnail_path ? convertFileSrc(asset.thumbnail_path) : null;

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="group flex items-center gap-2 px-3 py-2 border-b border-stone-800/40 cursor-grab hover:bg-stone-800/40 transition-colors"
      title={`Arrastrá para insertar — Click para agregar al final`}
      onClick={() => onInsert(asset, defaultCueType)}
    >
      {thumb ? (
        <img src={thumb} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />
      ) : (
        <span className="text-sm flex-shrink-0">
          {CUE_META[defaultCueType].icon}
        </span>
      )}
      <p className="text-xs text-stone-300 truncate flex-1" title={asset.name}>
        {asset.name.replace(/\.[^.]+$/, "")}
      </p>
      <span className="text-stone-600 text-xs opacity-0 group-hover:opacity-100">+</span>
    </div>
  );
}

// ── LIVE MODE ─────────────────────────────────────────────────────────────────

interface LiveProps {
  content: string;
  sessionId: string;
  assets: Asset[];
}

function LiveMode({ content, assets }: Omit<LiveProps, "sessionId">) {
  const [triggered, setTriggered] = useState<Set<string>>(new Set()); // assetId → triggered once
  const [ambientActive, setAmbientActive] = useState<Set<string>>(new Set()); // assetId → looping
  const [currentProject, setCurrentProject] = useState<string | null>(null); // assetId

  const assetMap = Object.fromEntries(assets.map((a) => [a.id, a]));

  const handleCue = async (cue: Cue) => {
    const asset = assetMap[cue.assetId];
    if (!asset) return;

    if (cue.type === "sfx") {
      await invoke("play_sfx", { filePath: asset.file_path, volume: 1.0 });
      setTriggered((prev) => new Set(prev).add(cue.assetId));
    } else if (cue.type === "ambient") {
      const channel = `ambient-${cue.assetId}`;
      if (ambientActive.has(cue.assetId)) {
        await invoke("stop_ambient", { channel });
        setAmbientActive((prev) => { const n = new Set(prev); n.delete(cue.assetId); return n; });
      } else {
        await invoke("play_ambient", { channel, filePath: asset.file_path, volume: 1.0 });
        setAmbientActive((prev) => new Set(prev).add(cue.assetId));
        setTriggered((prev) => new Set(prev).add(cue.assetId));
      }
    } else if (cue.type === "project") {
      await invoke("project_scene", {
        scene: { file_path: asset.file_path, asset_type: asset.asset_type, title: cue.label },
      });
      setCurrentProject(cue.assetId);
      setTriggered((prev) => new Set(prev).add(cue.assetId));
    }
  };

  const blocks = parseGuion(content);

  // Audio assets for quick soundboard
  const audioAssets = assets.filter((a) => a.asset_type === "audio").slice(0, 12);

  return (
    <div className="flex flex-1 min-h-0">
      {/* Script */}
      <div className="flex-1 overflow-y-auto px-10 py-8 min-w-0">
        {content.trim() === "" ? (
          <div className="text-stone-600 text-sm text-center py-20">
            El guión está vacío. Pasá a modo Prep para escribirlo.
          </div>
        ) : (
          <div className="max-w-2xl mx-auto">
            <LiveBlocks
              blocks={blocks}
              triggered={triggered}
              ambientActive={ambientActive}
              currentProject={currentProject}
              onCue={handleCue}
            />
          </div>
        )}
      </div>

      {/* Quick soundboard */}
      <QuickSoundboard
        assets={audioAssets}
        onPlay={async (asset) => {
          await invoke("play_sfx", { filePath: asset.file_path, volume: 1.0 });
        }}
      />
    </div>
  );
}

// ── Live blocks renderer ───────────────────────────────────────────────────────

interface LiveBlocksProps {
  blocks: ReturnType<typeof parseGuion>;
  triggered: Set<string>;
  ambientActive: Set<string>;
  currentProject: string | null;
  onCue: (cue: Cue) => void;
}

function LiveBlocks({ blocks, triggered, ambientActive, currentProject, onCue }: LiveBlocksProps) {
  // Group consecutive text blocks to render as markdown paragraphs
  const rendered: React.ReactNode[] = [];
  let textBuffer = "";
  let key = 0;

  const flushText = () => {
    if (textBuffer.trim()) {
      const t = textBuffer;
      rendered.push(
        <div key={key++} className="prose prose-invert prose-sm max-w-none mb-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{t}</ReactMarkdown>
        </div>
      );
      textBuffer = "";
    } else {
      textBuffer = "";
    }
  };

  for (const block of blocks) {
    if (block.kind === "text") {
      textBuffer += block.content;
    } else {
      flushText();
      const { cue } = block;
      const meta = CUE_META[cue.type];
      const isAmbientOn = ambientActive.has(cue.assetId);
      const wasTriggered = triggered.has(cue.assetId);
      const isProjected = currentProject === cue.assetId;

      let stateClass = meta.color;
      if (cue.type === "ambient" && isAmbientOn) {
        stateClass = "bg-green-700/70 border-green-500 text-green-100 animate-pulse";
      } else if (cue.type === "project" && isProjected) {
        stateClass = "bg-purple-700/70 border-purple-500 text-purple-100";
      } else if (wasTriggered && cue.type === "sfx") {
        stateClass = "bg-stone-700/60 border-stone-600 text-stone-400";
      }

      rendered.push(
        <button
          key={key++}
          onClick={() => onCue(cue)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium mx-1 my-1 transition-all hover:brightness-125 active:scale-95 ${stateClass}`}
          title={`${meta.label}: ${cue.label}`}
        >
          <span>{meta.icon}</span>
          <span>{cue.label}</span>
          {cue.type === "ambient" && isAmbientOn && (
            <span className="text-xs opacity-70">▶ stop</span>
          )}
          {wasTriggered && cue.type === "sfx" && (
            <span className="text-xs opacity-50">✓</span>
          )}
          {isProjected && (
            <span className="text-xs opacity-70">▶</span>
          )}
        </button>
      );
    }
  }
  flushText();

  return <>{rendered}</>;
}

// ── Quick soundboard ───────────────────────────────────────────────────────────

interface QuickSoundboardProps {
  assets: Asset[];
  onPlay: (asset: Asset) => void;
}

function QuickSoundboard({ assets, onPlay }: QuickSoundboardProps) {
  const [ambients, setAmbients] = useState<Set<string>>(new Set());

  const handleClick = async (asset: Asset) => {
    const channel = `quick-${asset.id}`;
    if (ambients.has(asset.id)) {
      await invoke("stop_ambient", { channel });
      setAmbients((prev) => { const n = new Set(prev); n.delete(asset.id); return n; });
    } else {
      // Try as SFX first; if it's meant to loop, user can right-click (future enhancement)
      onPlay(asset);
    }
  };

  const handleContextMenu = async (e: React.MouseEvent, asset: Asset) => {
    e.preventDefault();
    const channel = `quick-${asset.id}`;
    if (ambients.has(asset.id)) {
      await invoke("stop_ambient", { channel });
      setAmbients((prev) => { const n = new Set(prev); n.delete(asset.id); return n; });
    } else {
      await invoke("play_ambient", { channel, filePath: asset.file_path, volume: 1.0 });
      setAmbients((prev) => new Set(prev).add(asset.id));
    }
  };

  return (
    <div className="w-44 flex-shrink-0 border-l border-stone-800 flex flex-col bg-stone-900/30">
      <div className="px-3 py-2.5 border-b border-stone-800">
        <p className="text-xs font-medium text-stone-400">Quick sounds</p>
        <p className="text-xs text-stone-600 mt-0.5">Click = SFX · Derecho = Loop</p>
      </div>

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
        {assets.length === 0 ? (
          <p className="text-xs text-stone-600 text-center py-4">
            Sin audio importado
          </p>
        ) : (
          assets.map((asset) => {
            const isLooping = ambients.has(asset.id);
            return (
              <button
                key={asset.id}
                onClick={() => handleClick(asset)}
                onContextMenu={(e) => handleContextMenu(e, asset)}
                className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium transition-all border ${
                  isLooping
                    ? "bg-green-900/50 border-green-700 text-green-200 animate-pulse"
                    : "bg-stone-800/60 border-stone-700 text-stone-300 hover:bg-stone-700 hover:border-stone-600"
                }`}
                title={asset.name}
              >
                <span className="mr-1.5">{isLooping ? "🎵" : "🔊"}</span>
                <span className="truncate block">
                  {asset.name.replace(/\.[^.]+$/, "")}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

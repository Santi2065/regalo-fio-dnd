import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Asset } from "../../lib/types";
import { toast } from "../../lib/toast";
import {
  getSoundTriggers,
  setSoundTriggers,
  newTriggerId,
  defaultTrigger,
  describeWhen,
  describeAction,
  type SoundTrigger,
  type SoundTriggerConfig,
  type TriggerWhen,
  type TriggerAction,
  type CombatantSelector,
} from "../../lib/soundTriggers";

interface Props {
  sessionId: string;
}

const STANDARD_CONDITIONS = [
  "Prone",
  "Stunned",
  "Poisoned",
  "Blinded",
  "Frightened",
  "Restrained",
  "Incapacitated",
  "Paralyzed",
  "Charmed",
  "Exhaustion",
];

/**
 * Sub-sección colapsable dentro del SoundboardPanel para reglas if-then de
 * audio. CRUD completo, persistencia inmediata al DB. El engine que las
 * evalúa vive en SessionDashboard (useSoundTriggerEngine).
 *
 * Anti-saturación: cuando no hay reglas, render minimal — solo botón
 * "+ Agregar regla". Ningún DM nuevo ve fricción.
 */
export default function SoundTriggersSection({ sessionId }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const [triggers, setTriggers] = useState<SoundTrigger[]>([]);
  const [audioAssets, setAudioAssets] = useState<Asset[]>([]);
  const [imageAssets, setImageAssets] = useState<Asset[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Cargar triggers + audio + imágenes (para el selector de scene_changed).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [trigs, sessAudio, globAudio, sessImg] = await Promise.all([
          getSoundTriggers(sessionId),
          invoke<Asset[]>("get_assets", { sessionId, assetTypeFilter: "audio" }),
          invoke<Asset[]>("get_assets", { sessionId: null, assetTypeFilter: "audio" }),
          invoke<Asset[]>("get_assets", { sessionId, assetTypeFilter: "image" }),
        ]);
        if (cancelled) return;
        setTriggers(trigs);
        const audioMap = new Map<string, Asset>();
        for (const a of [...sessAudio, ...globAudio]) {
          if (!audioMap.has(a.id)) audioMap.set(a.id, a);
        }
        setAudioAssets([...audioMap.values()]);
        setImageAssets(sessImg);
      } catch (e) {
        console.error("[SoundTriggersSection] load failed", e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const persist = useCallback(
    async (next: SoundTrigger[]) => {
      try {
        await setSoundTriggers(sessionId, next);
        // Avisarle al engine que recargue.
        window.dispatchEvent(new CustomEvent("sound-triggers-changed"));
      } catch (e) {
        console.error("[SoundTriggersSection] save failed", e);
        toast.error("No se pudieron guardar las reglas");
      }
    },
    [sessionId],
  );

  const updateTrigger = (id: string, mutator: (t: SoundTrigger) => SoundTrigger) => {
    setTriggers((prev) => {
      const next = prev.map((t) => (t.id === id ? mutator(t) : t));
      persist(next);
      return next;
    });
  };

  const removeTrigger = (id: string) => {
    setTriggers((prev) => {
      const next = prev.filter((t) => t.id !== id);
      persist(next);
      return next;
    });
    if (editingId === id) setEditingId(null);
  };

  const addTrigger = () => {
    const id = newTriggerId();
    const t: SoundTrigger = {
      id,
      sessionId,
      sortOrder: triggers.length,
      config: defaultTrigger(),
    };
    setTriggers((prev) => {
      const next = [...prev, t];
      persist(next);
      return next;
    });
    setEditingId(id);
    setCollapsed(false);
  };

  const count = triggers.length;
  const enabledCount = triggers.filter((t) => t.config.enabled).length;

  if (!loaded) return null;

  return (
    <div className="border-t border-stone-800/80 bg-stone-900/30">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-stone-800/40 transition-colors"
      >
        <span className="text-stone-500 text-xs">{collapsed ? "▶" : "▼"}</span>
        <span className="text-sm font-medium text-vellum-200">Reglas automáticas</span>
        {count > 0 && (
          <span className="text-xs text-stone-500">
            {enabledCount}/{count}
          </span>
        )}
        <span className="ml-auto text-[10px] text-stone-600 hidden sm:inline">
          if-then audio
        </span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-3 space-y-2">
          {count === 0 ? (
            <div className="py-4 text-center">
              <p className="text-stone-500 text-xs mb-2">
                Sin reglas. Cuando agregues una, se va a evaluar en cada cambio de
                HP, ronda, condición o escena.
              </p>
              <button
                onClick={addTrigger}
                className="px-3 py-1.5 bg-amber-700/40 hover:bg-amber-700/60 text-amber-200 rounded text-xs transition-colors"
              >
                + Agregar primera regla
              </button>
            </div>
          ) : (
            <>
              {triggers.map((t) => (
                <TriggerRow
                  key={t.id}
                  trigger={t}
                  audioAssets={audioAssets}
                  imageAssets={imageAssets}
                  editing={editingId === t.id}
                  onToggle={(enabled) =>
                    updateTrigger(t.id, (x) => ({
                      ...x,
                      config: { ...x.config, enabled },
                    }))
                  }
                  onEdit={() => setEditingId(t.id)}
                  onClose={() => setEditingId(null)}
                  onChange={(config) =>
                    updateTrigger(t.id, (x) => ({ ...x, config }))
                  }
                  onRemove={() => removeTrigger(t.id)}
                />
              ))}
              <button
                onClick={addTrigger}
                className="w-full px-3 py-1.5 bg-stone-800/60 hover:bg-stone-800 text-stone-400 hover:text-stone-200 rounded text-xs transition-colors border border-dashed border-stone-700"
              >
                + Agregar regla
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── TriggerRow ───────────────────────────────────────────────────────────

interface RowProps {
  trigger: SoundTrigger;
  audioAssets: Asset[];
  imageAssets: Asset[];
  editing: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onClose: () => void;
  onChange: (config: SoundTriggerConfig) => void;
  onRemove: () => void;
}

function TriggerRow({
  trigger,
  audioAssets,
  imageAssets,
  editing,
  onToggle,
  onEdit,
  onClose,
  onChange,
  onRemove,
}: RowProps) {
  const { config } = trigger;
  const actionAssetId =
    config.action.kind === "play_loop" || config.action.kind === "play_oneshot" || config.action.kind === "stop_loop"
      ? config.action.assetId
      : null;
  const actionAsset = actionAssetId
    ? audioAssets.find((a) => a.id === actionAssetId)
    : undefined;

  return (
    <div
      className={`rounded-lg border ${
        editing ? "border-amber-700/60 bg-stone-900/80" : "border-stone-800 bg-stone-900/40"
      }`}
    >
      {/* Resumen */}
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="rounded accent-amber-500"
          title={config.enabled ? "Desactivar" : "Activar"}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-vellum-100 truncate">{config.label}</div>
          <div className="text-[11px] text-stone-500 truncate">
            {describeWhen(config.when)} → {describeAction(config.action, actionAsset?.name)}
          </div>
        </div>
        <button
          onClick={editing ? onClose : onEdit}
          className="text-stone-500 hover:text-stone-200 text-xs px-2 py-0.5 rounded transition-colors"
        >
          {editing ? "✕" : "Editar"}
        </button>
        <button
          onClick={onRemove}
          className="text-stone-700 hover:text-red-400 text-xs px-2 py-0.5 rounded transition-colors"
          title="Borrar regla"
        >
          ✕
        </button>
      </div>

      {/* Editor */}
      {editing && (
        <div className="border-t border-stone-800 px-3 py-3 space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-stone-500 mb-1">
              Nombre
            </label>
            <input
              value={config.label}
              onChange={(e) => onChange({ ...config, label: e.target.value })}
              className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-vellum-100 focus:outline-none focus:border-amber-600"
            />
          </div>

          <WhenEditor when={config.when} imageAssets={imageAssets} onChange={(w) => onChange({ ...config, when: w })} />
          <ActionEditor action={config.action} audioAssets={audioAssets} onChange={(a) => onChange({ ...config, action: a })} />
        </div>
      )}
    </div>
  );
}

// ── WhenEditor ───────────────────────────────────────────────────────────

const SELECTORS: { value: CombatantSelector; label: string }[] = [
  { value: "any_player", label: "cualquier PJ" },
  { value: "any_enemy", label: "cualquier enemigo" },
  { value: "active", label: "el combatiente activo" },
  { value: "any", label: "cualquier combatiente" },
];

function WhenEditor({
  when,
  imageAssets,
  onChange,
}: {
  when: TriggerWhen;
  imageAssets: Asset[];
  onChange: (w: TriggerWhen) => void;
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-stone-500 mb-1">
        Cuando
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={when.kind}
          onChange={(e) => {
            const kind = e.target.value as TriggerWhen["kind"];
            // Reset al cambiar de tipo, manteniendo defaults sensatos.
            switch (kind) {
              case "hp_below":
                onChange({ kind, selector: "any_player", percent: 25 });
                break;
              case "round_reached":
                onChange({ kind, round: 3 });
                break;
              case "condition_added":
                onChange({ kind, condition: "Stunned", selector: "any" });
                break;
              case "scene_changed":
                onChange({ kind, assetId: imageAssets[0]?.id ?? "" });
                break;
            }
          }}
          className="bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-vellum-100 focus:outline-none focus:border-amber-600"
        >
          <option value="hp_below">HP por debajo de</option>
          <option value="round_reached">Empieza la ronda</option>
          <option value="condition_added">Recibe condición</option>
          <option value="scene_changed">Se proyecta escena</option>
        </select>

        {when.kind === "hp_below" && (
          <>
            <select
              value={when.selector}
              onChange={(e) =>
                onChange({ ...when, selector: e.target.value as CombatantSelector })
              }
              className="bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-vellum-100 focus:outline-none focus:border-amber-600"
            >
              {SELECTORS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={100}
              value={when.percent}
              onChange={(e) => onChange({ ...when, percent: Math.max(1, Math.min(100, Number(e.target.value) || 0)) })}
              className="bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-vellum-100 focus:outline-none focus:border-amber-600 w-14 text-center"
            />
            <span className="text-stone-500 text-xs">%</span>
          </>
        )}

        {when.kind === "round_reached" && (
          <input
            type="number"
            min={1}
            value={when.round}
            onChange={(e) => onChange({ ...when, round: Math.max(1, Number(e.target.value) || 1) })}
            className="bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-vellum-100 focus:outline-none focus:border-amber-600 w-14 text-center"
          />
        )}

        {when.kind === "condition_added" && (
          <>
            <select
              value={when.selector}
              onChange={(e) =>
                onChange({ ...when, selector: e.target.value as CombatantSelector })
              }
              className="bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-vellum-100 focus:outline-none focus:border-amber-600"
            >
              {SELECTORS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <select
              value={when.condition}
              onChange={(e) => onChange({ ...when, condition: e.target.value })}
              className="bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-vellum-100 focus:outline-none focus:border-amber-600"
            >
              {STANDARD_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </>
        )}

        {when.kind === "scene_changed" && (
          <select
            value={when.assetId}
            onChange={(e) => onChange({ ...when, assetId: e.target.value })}
            className="bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-vellum-100 focus:outline-none focus:border-amber-600 max-w-[200px] truncate"
          >
            {imageAssets.length === 0 ? (
              <option value="">Sin imágenes en la sesión</option>
            ) : (
              imageAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))
            )}
          </select>
        )}
      </div>
    </div>
  );
}

// ── ActionEditor ─────────────────────────────────────────────────────────

function ActionEditor({
  action,
  audioAssets,
  onChange,
}: {
  action: TriggerAction;
  audioAssets: Asset[];
  onChange: (a: TriggerAction) => void;
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-stone-500 mb-1">
        Disparar
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={action.kind}
          onChange={(e) => {
            const kind = e.target.value as TriggerAction["kind"];
            switch (kind) {
              case "play_loop":
                onChange({ kind, assetId: audioAssets[0]?.id ?? "", volume: 0.7 });
                break;
              case "play_oneshot":
                onChange({ kind, assetId: audioAssets[0]?.id ?? "", volume: 1.0 });
                break;
              case "stop_loop":
                onChange({ kind, assetId: audioAssets[0]?.id ?? "" });
                break;
              case "stop_all":
                onChange({ kind });
                break;
            }
          }}
          className="bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-vellum-100 focus:outline-none focus:border-amber-600"
        >
          <option value="play_loop">Loop ambient</option>
          <option value="play_oneshot">Disparar SFX</option>
          <option value="stop_loop">Cortar un loop</option>
          <option value="stop_all">Cortar todo</option>
        </select>

        {(action.kind === "play_loop" ||
          action.kind === "play_oneshot" ||
          action.kind === "stop_loop") && (
          <select
            value={action.assetId}
            onChange={(e) => onChange({ ...action, assetId: e.target.value })}
            className="bg-stone-800 border border-stone-700 rounded px-2 py-1 text-xs text-vellum-100 focus:outline-none focus:border-amber-600 max-w-[180px] truncate"
          >
            {audioAssets.length === 0 ? (
              <option value="">Sin audio</option>
            ) : (
              audioAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))
            )}
          </select>
        )}

        {(action.kind === "play_loop" || action.kind === "play_oneshot") && (
          <>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={action.volume}
              onChange={(e) => onChange({ ...action, volume: Number(e.target.value) })}
              className="accent-amber-500 w-20"
            />
            <span className="text-stone-500 text-[10px] w-7">
              {Math.round(action.volume * 100)}%
            </span>
          </>
        )}
      </div>
    </div>
  );
}

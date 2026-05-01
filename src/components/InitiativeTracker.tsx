import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Combatant {
  id: string;
  name: string;
  initiative: number;
  hp: number;
  maxHp: number;
  type: "player" | "enemy" | "neutral";
  conditions: string[];
  notes: string;
}

interface RawCombatant {
  id: string;
  session_id: string;
  name: string;
  initiative: number;
  hp: number;
  max_hp: number;
  type: string;
  conditions: string[];
  notes: string;
  sort_order: number;
}

interface RawCombatState {
  session_id: string;
  current_turn: number;
  round: number;
  custom_conditions: string[];
}

const STANDARD_CONDITIONS = ["Prone", "Stunned", "Poisoned", "Blinded", "Frightened", "Restrained", "Incapacitated", "Paralyzed", "Charmed", "Exhaustion"];

const TYPE_STYLES: Record<Combatant["type"], string> = {
  player:  "border-l-4 border-l-emerald-500",
  enemy:   "border-l-4 border-l-red-500",
  neutral: "border-l-4 border-l-stone-500",
};
const TYPE_BADGE: Record<Combatant["type"], string> = {
  player:  "bg-emerald-900/50 text-emerald-300",
  enemy:   "bg-red-900/50 text-red-300",
  neutral: "bg-stone-800 text-stone-400",
};

let idCounter = 0;
const uid = () => `c-${++idCounter}-${Date.now()}`;

const SAVE_DEBOUNCE_MS = 400;

interface Props {
  sessionId: string;
}

export default function InitiativeTracker({ sessionId }: Props) {
  const [combatants, setCombatants] = useState<Combatant[]>([]);
  const [currentTurn, setCurrentTurn] = useState(0);
  const [round, setRound] = useState(1);
  const [customConditions, setCustomConditions] = useState<string[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [hpEdit, setHpEdit] = useState<{ id: string; delta: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const combatantsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Add form state
  const [form, setForm] = useState({
    name: "",
    initiative: "",
    hp: "",
    type: "enemy" as Combatant["type"],
    count: "1",
  });

  const allConditions = [...STANDARD_CONDITIONS, ...customConditions];

  // ── Load on mount / session change ──────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    setLoaded(false);
    let cancelled = false;
    (async () => {
      try {
        const [rawCombatants, combatState] = await Promise.all([
          invoke<RawCombatant[]>("get_combatants", { sessionId }),
          invoke<RawCombatState>("get_combat_state", { sessionId }),
        ]);
        if (cancelled) return;
        setCombatants(
          rawCombatants.map((c) => ({
            id: c.id,
            name: c.name,
            initiative: c.initiative,
            hp: c.hp,
            maxHp: c.max_hp,
            type: (c.type === "player" || c.type === "enemy" || c.type === "neutral"
              ? c.type
              : "enemy") as Combatant["type"],
            conditions: c.conditions ?? [],
            notes: c.notes ?? "",
          }))
        );
        setCurrentTurn(combatState.current_turn);
        setRound(combatState.round);
        setCustomConditions(combatState.custom_conditions ?? []);
      } catch (e) {
        console.error("[InitiativeTracker] load failed", e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // ── Debounced save: combatants ──────────────────────────────────────────
  useEffect(() => {
    if (!loaded || !sessionId) return;
    if (combatantsSaveTimer.current) clearTimeout(combatantsSaveTimer.current);
    combatantsSaveTimer.current = setTimeout(async () => {
      try {
        await invoke("set_combatants", {
          sessionId,
          combatants: combatants.map((c) => ({
            id: c.id,
            name: c.name,
            initiative: c.initiative,
            hp: c.hp,
            max_hp: c.maxHp,
            type: c.type,
            conditions: c.conditions,
            notes: c.notes,
          })),
        });
      } catch (e) {
        console.error("[InitiativeTracker] save combatants failed", e);
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (combatantsSaveTimer.current) clearTimeout(combatantsSaveTimer.current);
    };
  }, [combatants, loaded, sessionId]);

  // ── Debounced save: combat state ─────────────────────────────────────────
  useEffect(() => {
    if (!loaded || !sessionId) return;
    if (stateSaveTimer.current) clearTimeout(stateSaveTimer.current);
    stateSaveTimer.current = setTimeout(async () => {
      try {
        await invoke("set_combat_state", {
          sessionId,
          currentTurn,
          round,
          customConditions,
        });
      } catch (e) {
        console.error("[InitiativeTracker] save state failed", e);
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (stateSaveTimer.current) clearTimeout(stateSaveTimer.current);
    };
  }, [currentTurn, round, customConditions, loaded, sessionId]);

  const sorted = [...combatants].sort((a, b) => b.initiative - a.initiative);
  const activeCombatant = sorted[currentTurn] ?? null;

  const addCombatants = () => {
    const name = form.name.trim();
    const init = parseInt(form.initiative) || 0;
    const hp = parseInt(form.hp) || 10;
    const count = Math.max(1, Math.min(20, parseInt(form.count) || 1));
    if (!name) return;

    const news: Combatant[] = Array.from({ length: count }, (_, i) => ({
      id: uid(),
      name: count > 1 ? `${name} ${i + 1}` : name,
      initiative: count > 1 ? init - 2 + Math.floor(Math.random() * 5) : init,
      hp,
      maxHp: hp,
      type: form.type,
      conditions: [],
      notes: "",
    }));

    setCombatants((prev) => [...prev, ...news]);
    setForm({ name: "", initiative: "", hp: "", type: form.type, count: "1" });
    setShowAddForm(false);
  };

  const remove = (id: string) => {
    const idx = sorted.findIndex((c) => c.id === id);
    setCombatants((prev) => prev.filter((c) => c.id !== id));
    if (idx <= currentTurn && currentTurn > 0) {
      setCurrentTurn((t) => Math.max(0, t - 1));
    }
  };

  const nextTurn = () => {
    if (sorted.length === 0) return;
    const next = (currentTurn + 1) % sorted.length;
    if (next === 0) setRound((r) => r + 1);
    setCurrentTurn(next);
  };

  const prevTurn = () => {
    if (sorted.length === 0) return;
    if (currentTurn === 0) {
      setCurrentTurn(sorted.length - 1);
      setRound((r) => Math.max(1, r - 1));
    } else {
      setCurrentTurn((t) => t - 1);
    }
  };

  const applyHp = (id: string, delta: string) => {
    const n = parseInt(delta);
    if (isNaN(n)) return;
    setCombatants((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, hp: Math.min(c.maxHp, c.hp + n) } : c
      )
    );
    setHpEdit(null);
  };

  const toggleCondition = (id: string, cond: string) => {
    setCombatants((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              conditions: c.conditions.includes(cond)
                ? c.conditions.filter((x) => x !== cond)
                : [...c.conditions, cond],
            }
          : c
      )
    );
  };

  const reset = () => {
    setCombatants([]);
    setCurrentTurn(0);
    setRound(1);
  };

  return (
    <div className="h-full flex flex-col bg-stone-950">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-800 flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-stone-500 text-xs">Ronda</span>
          <span className="text-xl font-bold text-amber-400 tabular-nums w-7 text-center">{round}</span>
        </div>

        {sorted.length > 0 && (
          <>
            <div className="flex-1 min-w-0 truncate">
              <span className="text-xs text-stone-500">▶ </span>
              <span className="text-xs font-semibold text-stone-100 truncate">{activeCombatant?.name}</span>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <button onClick={prevTurn} className="px-2 py-1 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs transition-colors">‹</button>
              <button onClick={nextTurn} className="px-2 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white text-xs font-medium transition-colors">Sig ›</button>
            </div>
          </>
        )}

        <div className="flex gap-1 flex-shrink-0 ml-auto">
          <button onClick={() => setShowAddForm((v) => !v)} className="px-2 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs transition-colors">+ Agregar</button>
          {combatants.length > 0 && (
            <button onClick={reset} className="px-2 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-600 hover:text-stone-300 text-xs transition-colors">↺</button>
          )}
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="flex items-center gap-3 px-6 py-3 border-b border-stone-800 bg-stone-900/50 flex-shrink-0 flex-wrap">
          <input
            autoFocus
            placeholder="Nombre"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && addCombatants()}
            className="bg-stone-800 border border-stone-700 rounded px-2.5 py-1.5 text-sm text-stone-100 focus:outline-none focus:border-amber-600 w-40"
          />
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-stone-500">Init</label>
            <input
              type="number"
              placeholder="20"
              value={form.initiative}
              onChange={(e) => setForm({ ...form, initiative: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && addCombatants()}
              className="bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-sm text-stone-100 focus:outline-none focus:border-amber-600 w-16 text-center"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-stone-500">HP</label>
            <input
              type="number"
              placeholder="30"
              value={form.hp}
              onChange={(e) => setForm({ ...form, hp: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && addCombatants()}
              className="bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-sm text-stone-100 focus:outline-none focus:border-amber-600 w-16 text-center"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-stone-500">Cant.</label>
            <input
              type="number"
              min="1"
              max="20"
              value={form.count}
              onChange={(e) => setForm({ ...form, count: e.target.value })}
              className="bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-sm text-stone-100 focus:outline-none focus:border-amber-600 w-14 text-center"
            />
          </div>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as Combatant["type"] })}
            className="bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-sm text-stone-100 focus:outline-none"
          >
            <option value="player">Jugador</option>
            <option value="enemy">Enemigo</option>
            <option value="neutral">Neutral</option>
          </select>
          <button
            onClick={addCombatants}
            className="px-4 py-1.5 bg-amber-700 hover:bg-amber-600 text-white rounded text-sm font-medium transition-colors"
          >
            Agregar
          </button>
          <button
            onClick={() => setShowAddForm(false)}
            className="text-stone-500 hover:text-stone-300 text-sm transition-colors"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Combatant list */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-3 opacity-20">⚔</div>
            <p className="text-stone-600 text-sm mb-4">No hay combatientes</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg text-sm transition-colors"
            >
              + Agregar combatientes
            </button>
          </div>
        ) : (
          <div className="divide-y divide-stone-800/60">
            {sorted.map((c, idx) => {
              const isActive = idx === currentTurn;
              const isDead = c.hp <= 0;
              const hpPct = Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100));
              const hpColor =
                hpPct > 60 ? "bg-emerald-500" : hpPct > 25 ? "bg-amber-500" : "bg-red-500";
              const isExpanded = expandedId === c.id;

              return (
                <div
                  key={c.id}
                  className={`transition-colors ${
                    isActive ? "bg-amber-900/20" : isDead ? "opacity-50" : "hover:bg-stone-800/30"
                  } ${TYPE_STYLES[c.type]}`}
                >
                  <div className="flex items-center gap-2 px-3 py-2">
                    {/* Turn indicator */}
                    <div className="w-5 flex-shrink-0 text-center">
                      {isActive ? (
                        <span className="text-amber-400 text-sm">▶</span>
                      ) : (
                        <span className="text-stone-700 text-xs tabular-nums">{idx + 1}</span>
                      )}
                    </div>

                    {/* Initiative */}
                    <div className="w-10 text-center flex-shrink-0">
                      <span
                        className={`text-lg font-bold tabular-nums ${
                          isActive ? "text-amber-400" : "text-stone-300"
                        }`}
                      >
                        {c.initiative}
                      </span>
                    </div>

                    {/* Name + type badge */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-medium truncate ${
                            isDead
                              ? "line-through text-stone-600"
                              : isActive
                              ? "text-amber-100"
                              : "text-stone-200"
                          }`}
                        >
                          {c.name}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 ${TYPE_BADGE[c.type]}`}>
                          {c.type === "player" ? "PJ" : c.type === "enemy" ? "Enemigo" : "NPC"}
                        </span>
                      </div>
                      {c.conditions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {c.conditions.map((cond) => (
                            <span
                              key={cond}
                              onClick={() => toggleCondition(c.id, cond)}
                              className="text-xs bg-purple-900/50 text-purple-300 px-1.5 rounded cursor-pointer hover:bg-purple-900/80 transition-colors"
                            >
                              {cond}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* HP bar + edit */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <div className="w-16">
                        <div className="flex justify-between text-xs text-stone-400 mb-0.5">
                          <span>{c.hp}</span>
                          <span className="text-stone-600">/{c.maxHp}</span>
                        </div>
                        <div className="h-1.5 bg-stone-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${hpColor}`}
                            style={{ width: `${hpPct}%` }}
                          />
                        </div>
                      </div>

                      {/* HP delta input */}
                      {hpEdit?.id === c.id ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            applyHp(c.id, hpEdit.delta);
                          }}
                          className="flex gap-1"
                        >
                          <input
                            autoFocus
                            value={hpEdit.delta}
                            onChange={(e) => setHpEdit({ id: c.id, delta: e.target.value })}
                            placeholder="±HP"
                            className="w-16 bg-stone-800 border border-stone-600 rounded px-2 py-0.5 text-xs text-center focus:outline-none focus:border-amber-500"
                            onBlur={() => setHpEdit(null)}
                            onKeyDown={(e) => e.key === "Escape" && setHpEdit(null)}
                          />
                          <button
                            type="submit"
                            className="px-2 py-0.5 bg-amber-700 hover:bg-amber-600 text-white text-xs rounded transition-colors"
                          >
                            ✓
                          </button>
                        </form>
                      ) : (
                        <button
                          onClick={() => setHpEdit({ id: c.id, delta: "" })}
                          title="Modificar HP (+daño / -curación)"
                          className="text-xs px-2 py-0.5 bg-stone-800 hover:bg-stone-700 text-stone-400 hover:text-stone-200 rounded transition-colors"
                        >
                          ±HP
                        </button>
                      )}

                      {/* Expand / conditions */}
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : c.id)}
                        title="Condiciones y notas"
                        className="text-stone-600 hover:text-stone-300 text-xs transition-colors"
                      >
                        {isExpanded ? "▲" : "▼"}
                      </button>

                      {/* Remove */}
                      <button
                        onClick={() => remove(c.id)}
                        className="text-stone-700 hover:text-red-400 text-xs transition-colors"
                        title="Eliminar"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Expanded: conditions + notes */}
                  {isExpanded && (
                    <div className="px-12 pb-3 space-y-2">
                      <div className="flex flex-wrap gap-1">
                        {allConditions.map((cond) => (
                          <button
                            key={cond}
                            onClick={() => toggleCondition(c.id, cond)}
                            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                              c.conditions.includes(cond)
                                ? "border-purple-600 bg-purple-900/50 text-purple-300"
                                : "border-stone-700 text-stone-500 hover:border-stone-500 hover:text-stone-300"
                            }`}
                          >
                            {cond}
                          </button>
                        ))}
                      </div>
                      <input
                        value={c.notes}
                        onChange={(e) =>
                          setCombatants((prev) =>
                            prev.map((x) =>
                              x.id === c.id ? { ...x, notes: e.target.value } : x
                            )
                          )
                        }
                        placeholder="Notas..."
                        className="w-full bg-stone-800/50 border border-stone-700 rounded px-2.5 py-1 text-xs text-stone-300 focus:outline-none focus:border-stone-500"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

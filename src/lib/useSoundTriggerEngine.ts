import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  getSoundTriggers,
  type SoundTrigger,
  type TriggerWhen,
  type CombatantSelector,
} from "./soundTriggers";
import { useLiveStateStore, type LiveCombatant } from "../store/liveStateStore";
import { playOneShot, startLoop, stopLoop, stopAllAudio, channels } from "./audioController";
import type { Asset } from "./types";

/**
 * Engine de evaluación de sound triggers.
 *
 * Pattern: hook único que se monta en SessionDashboard y subscribe al
 * `liveStateStore`. Detecta transiciones (HP cruzando umbral, ronda
 * cambiando, condición agregada, escena cambiando) y dispara la acción
 * configurada (play loop / play sfx / stop).
 *
 * Anti-doble-disparo: para cada (triggerId, target) guarda un flag
 * "fired" que se mantiene mientras la condición sigue activa. Se resetea
 * cuando la condición vuelve a false (HP sube de nuevo, condición
 * removida, escena cambia a otra cosa).
 */

interface EngineFiringState {
  /** Set de claves "triggerId|targetId" que ya dispararon en este ciclo. */
  fired: Set<string>;
  /**
   * Si true, la próxima observación pre-popula `fired` para reglas que ya
   * cumplen su condición pero NO invoca acciones — evita que cargar una
   * sesión con HP bajo o ronda alta haga sonar todo de golpe.
   */
  warmup: boolean;
}

export function useSoundTriggerEngine(sessionId: string | null, enabled: boolean) {
  const triggersRef = useRef<SoundTrigger[]>([]);
  const audioAssetsRef = useRef<Map<string, Asset>>(new Map());
  const stateRef = useRef<EngineFiringState>({ fired: new Set(), warmup: true });
  const prevRef = useRef<{
    combatants: LiveCombatant[];
    round: number;
    activeSceneAssetId: string | null;
  }>({ combatants: [], round: 0, activeSceneAssetId: null });

  // Carga inicial de triggers + assets de audio para resolver IDs a paths.
  useEffect(() => {
    if (!sessionId || !enabled) {
      triggersRef.current = [];
      stateRef.current.fired.clear();
      stateRef.current.warmup = true;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [triggers, sessAssets, globalAssets] = await Promise.all([
          getSoundTriggers(sessionId),
          invoke<Asset[]>("get_assets", { sessionId, assetTypeFilter: "audio" }),
          invoke<Asset[]>("get_assets", { sessionId: null, assetTypeFilter: "audio" }),
        ]);
        if (cancelled) return;
        triggersRef.current = triggers;
        const map = new Map<string, Asset>();
        for (const a of [...sessAssets, ...globalAssets]) {
          if (!map.has(a.id)) map.set(a.id, a);
        }
        audioAssetsRef.current = map;
        // Reset firing state al recargar — empezamos limpios + warmup activo
        // así no disparamos al cargar una sesión existente.
        stateRef.current.fired.clear();
        stateRef.current.warmup = true;
      } catch (e) {
        console.error("[soundTriggerEngine] load failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, enabled]);

  // Listener para cuando otros componentes editan los triggers — un evento
  // custom emitido por la UI de CRUD evita que tengamos que recargar manual.
  useEffect(() => {
    if (!sessionId || !enabled) return;
    const handler = async () => {
      try {
        triggersRef.current = await getSoundTriggers(sessionId);
        // No reseteamos `fired` — un trigger nuevo puede disparar pero
        // los que ya dispararon mantienen su estado.
      } catch (e) {
        console.error("[soundTriggerEngine] reload failed", e);
      }
    };
    window.addEventListener("sound-triggers-changed", handler);
    return () => window.removeEventListener("sound-triggers-changed", handler);
  }, [sessionId, enabled]);

  // El loop principal: subscribe al store y compara con el snapshot anterior.
  useEffect(() => {
    if (!sessionId || !enabled) return;

    const unsub = useLiveStateStore.subscribe((state) => {
      const prev = prevRef.current;
      const next = {
        combatants: state.combatants,
        round: state.round,
        activeSceneAssetId: state.activeSceneAssetId,
        currentTurnIndex: state.currentTurnIndex,
      };

      // Durante warmup, simulamos el estado anterior como igual al actual
      // para que ninguna regla detecte una "transición" — solo recordamos
      // qué reglas ya tienen condición activa en `fired`.
      const effectivePrev = stateRef.current.warmup ? next : prev;

      for (const trigger of triggersRef.current) {
        if (!trigger.config.enabled) continue;
        evaluateTrigger(
          trigger,
          effectivePrev,
          next,
          stateRef.current,
          audioAssetsRef.current,
        );
      }

      stateRef.current.warmup = false;

      prevRef.current = {
        combatants: state.combatants,
        round: state.round,
        activeSceneAssetId: state.activeSceneAssetId,
      };
    });

    // Snapshot inicial para que `prev` coincida con el state actual y no
    // dispare todo al montarse.
    const s = useLiveStateStore.getState();
    prevRef.current = {
      combatants: s.combatants,
      round: s.round,
      activeSceneAssetId: s.activeSceneAssetId,
    };

    return unsub;
  }, [sessionId, enabled]);
}

// ── Evaluación ───────────────────────────────────────────────────────────

interface Snapshot {
  combatants: LiveCombatant[];
  round: number;
  activeSceneAssetId: string | null;
}

interface NextSnapshot extends Snapshot {
  currentTurnIndex: number;
}

function evaluateTrigger(
  trigger: SoundTrigger,
  prev: Snapshot,
  next: NextSnapshot,
  firingState: EngineFiringState,
  audioAssets: Map<string, Asset>,
) {
  const when = trigger.config.when;

  switch (when.kind) {
    case "hp_below":
      evaluateHpBelow(trigger, when, prev, next, firingState, audioAssets);
      break;
    case "round_reached":
      evaluateRoundReached(trigger, when, prev, next, firingState, audioAssets);
      break;
    case "condition_added":
      evaluateConditionAdded(trigger, when, prev, next, firingState, audioAssets);
      break;
    case "scene_changed":
      evaluateSceneChanged(trigger, when, prev, next, firingState, audioAssets);
      break;
  }
}

function evaluateHpBelow(
  trigger: SoundTrigger,
  when: Extract<TriggerWhen, { kind: "hp_below" }>,
  prev: Snapshot,
  next: NextSnapshot,
  firingState: EngineFiringState,
  audioAssets: Map<string, Asset>,
) {
  const targets = filterCombatants(next.combatants, when.selector, next.currentTurnIndex);
  const prevById = new Map(prev.combatants.map((c) => [c.id, c]));

  for (const c of targets) {
    if (c.maxHp <= 0) continue;
    const pct = (c.hp / c.maxHp) * 100;
    const isBelow = pct <= when.percent && c.hp > 0;
    const key = `${trigger.id}|${c.id}`;

    // Detectar transición: solo dispara cuando cruza al umbral. Si el
    // combatiente ya estaba abajo en la observación previa (o no existía),
    // marcamos como "ya disparado" sin invocar la acción para evitar que
    // se dispare al cargar la sesión.
    const prevC = prevById.get(c.id);
    const wasBelow = prevC
      ? prevC.maxHp > 0 &&
        prevC.hp > 0 &&
        (prevC.hp / prevC.maxHp) * 100 <= when.percent
      : false;

    if (isBelow && !firingState.fired.has(key)) {
      if (!prevC || wasBelow) {
        // Primera observación o ya estaba abajo — solo recordamos sin disparar.
        firingState.fired.add(key);
      } else {
        // Transición real: estaba arriba, ahora abajo.
        firingState.fired.add(key);
        fireAction(trigger, audioAssets);
      }
    } else if (!isBelow && firingState.fired.has(key)) {
      // HP recuperó por encima del umbral: re-armamos el trigger.
      firingState.fired.delete(key);
    }
  }

  // Limpiar `fired` para combatientes que ya no existen.
  const livingIds = new Set(next.combatants.map((c) => c.id));
  for (const key of [...firingState.fired]) {
    if (!key.startsWith(`${trigger.id}|`)) continue;
    const targetId = key.slice(trigger.id.length + 1);
    if (!livingIds.has(targetId)) firingState.fired.delete(key);
  }
}

function evaluateRoundReached(
  trigger: SoundTrigger,
  when: Extract<TriggerWhen, { kind: "round_reached" }>,
  prev: Snapshot,
  next: NextSnapshot,
  firingState: EngineFiringState,
  audioAssets: Map<string, Asset>,
) {
  const key = `${trigger.id}|round`;
  // Disparar solo en el momento exacto en que pasa de < target a >= target.
  if (prev.round < when.round && next.round >= when.round && !firingState.fired.has(key)) {
    firingState.fired.add(key);
    fireAction(trigger, audioAssets);
  } else if (next.round < when.round && firingState.fired.has(key)) {
    // Si volvieron a una ronda anterior (reset), re-armamos.
    firingState.fired.delete(key);
  }
}

function evaluateConditionAdded(
  trigger: SoundTrigger,
  when: Extract<TriggerWhen, { kind: "condition_added" }>,
  prev: Snapshot,
  next: NextSnapshot,
  firingState: EngineFiringState,
  audioAssets: Map<string, Asset>,
) {
  const targets = filterCombatants(next.combatants, when.selector, next.currentTurnIndex);
  const prevById = new Map(prev.combatants.map((c) => [c.id, c]));

  for (const c of targets) {
    const prevC = prevById.get(c.id);
    const hadCondition = prevC?.conditions.includes(when.condition) ?? false;
    const hasCondition = c.conditions.includes(when.condition);
    const key = `${trigger.id}|${c.id}|${when.condition}`;

    if (hasCondition && !firingState.fired.has(key)) {
      if (!prevC || hadCondition) {
        // Primera observación o ya tenía la condición — recordar sin disparar.
        firingState.fired.add(key);
      } else {
        firingState.fired.add(key);
        fireAction(trigger, audioAssets);
      }
    } else if (!hasCondition && firingState.fired.has(key)) {
      firingState.fired.delete(key);
    }
  }
}

function evaluateSceneChanged(
  trigger: SoundTrigger,
  when: Extract<TriggerWhen, { kind: "scene_changed" }>,
  prev: Snapshot,
  next: NextSnapshot,
  firingState: EngineFiringState,
  audioAssets: Map<string, Asset>,
) {
  const key = `${trigger.id}|scene`;
  const wasMatch = prev.activeSceneAssetId === when.assetId;
  const isMatch = next.activeSceneAssetId === when.assetId;

  if (!wasMatch && isMatch && !firingState.fired.has(key)) {
    firingState.fired.add(key);
    fireAction(trigger, audioAssets);
  } else if (!isMatch && firingState.fired.has(key)) {
    firingState.fired.delete(key);
  }
}

// ── Selectores y disparo ──────────────────────────────────────────────────

function filterCombatants(
  combatants: LiveCombatant[],
  selector: CombatantSelector,
  currentTurnIndex: number,
): LiveCombatant[] {
  switch (selector) {
    case "active":
      // currentTurnIndex es índice en el array ordenado por iniciativa.
      // El store recibe combatants ya ordenados desde InitiativeTracker.
      return combatants[currentTurnIndex] ? [combatants[currentTurnIndex]] : [];
    case "any_player":
      return combatants.filter((c) => c.type === "player");
    case "any_enemy":
      return combatants.filter((c) => c.type === "enemy");
    case "any":
      return combatants;
  }
}

async function fireAction(trigger: SoundTrigger, audioAssets: Map<string, Asset>) {
  const action = trigger.config.action;
  try {
    switch (action.kind) {
      case "play_oneshot": {
        const asset = audioAssets.get(action.assetId);
        if (!asset) {
          console.warn("[soundTriggerEngine] asset no encontrado", action.assetId);
          return;
        }
        await playOneShot(asset.file_path, action.volume);
        break;
      }
      case "play_loop": {
        const asset = audioAssets.get(action.assetId);
        if (!asset) {
          console.warn("[soundTriggerEngine] asset no encontrado", action.assetId);
          return;
        }
        await startLoop(channels.scriptAmbient(action.assetId), asset.file_path, action.volume);
        break;
      }
      case "stop_loop":
        await stopLoop(channels.scriptAmbient(action.assetId));
        break;
      case "stop_all":
        await stopAllAudio();
        break;
    }
    console.log(`[soundTriggerEngine] disparó "${trigger.config.label}"`);
  } catch (e) {
    console.error("[soundTriggerEngine] fire failed", e);
  }
}

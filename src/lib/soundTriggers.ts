import { invoke } from "@tauri-apps/api/core";

/**
 * Sound triggers — reglas if-then evaluadas en el frontend.
 *
 * Diseño: el engine corre 100% en React (todas las fuentes de eventos viven
 * en el state — initiative, scene proyectada, etc.). El backend solo
 * persiste el JSON. El shape `SoundTriggerConfig` se valida acá.
 *
 * Cantidad esperada de reglas por sesión: 3-7. No queremos que el DM se
 * arme un sistema Turing-completo.
 */

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Selector del combatiente al que aplica un trigger HP-based.
 * - "active": el que está actualmente jugando su turno
 * - "any_player": cualquier PJ
 * - "any_enemy": cualquier enemigo
 * - "any": cualquier combatiente
 */
export type CombatantSelector = "active" | "any_player" | "any_enemy" | "any";

export type TriggerWhen =
  | {
      kind: "hp_below";
      selector: CombatantSelector;
      /** 1-100, porcentaje del max HP. */
      percent: number;
    }
  | {
      kind: "round_reached";
      /** Número de ronda exacto, p.ej. 3 → dispara al pasar a la ronda 3. */
      round: number;
    }
  | {
      kind: "condition_added";
      /** El nombre exacto de la condición, p.ej. "Stunned". */
      condition: string;
      selector: CombatantSelector;
    }
  | {
      kind: "scene_changed";
      /** ID del asset (imagen/video) que tiene que pasar a estar proyectado. */
      assetId: string;
    };

export type TriggerAction =
  | {
      kind: "play_loop";
      assetId: string;
      volume: number;
    }
  | {
      kind: "play_oneshot";
      assetId: string;
      volume: number;
    }
  | {
      kind: "stop_loop";
      assetId: string;
    }
  | { kind: "stop_all" };

export interface SoundTriggerConfig {
  enabled: boolean;
  label: string;
  when: TriggerWhen;
  action: TriggerAction;
}

export interface SoundTrigger {
  id: string;
  sessionId: string;
  config: SoundTriggerConfig;
  sortOrder: number;
}

// ── Persistencia ──────────────────────────────────────────────────────────

interface RawTrigger {
  id: string;
  session_id: string;
  config: string;
  sort_order: number;
}

export async function getSoundTriggers(sessionId: string): Promise<SoundTrigger[]> {
  const raw = await invoke<RawTrigger[]>("get_sound_triggers", { sessionId });
  return raw
    .map((r) => {
      try {
        const config = JSON.parse(r.config) as SoundTriggerConfig;
        return {
          id: r.id,
          sessionId: r.session_id,
          sortOrder: r.sort_order,
          config,
        };
      } catch (e) {
        console.error("[soundTriggers] config inválido para", r.id, e);
        return null;
      }
    })
    .filter((t): t is SoundTrigger => t !== null);
}

export async function setSoundTriggers(
  sessionId: string,
  triggers: SoundTrigger[],
): Promise<void> {
  await invoke("set_sound_triggers", {
    sessionId,
    triggers: triggers.map((t) => ({
      id: t.id,
      config: JSON.stringify(t.config),
    })),
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────

let triggerCounter = 0;

export function newTriggerId(): string {
  return `trigger-${Date.now()}-${++triggerCounter}`;
}

export function defaultTrigger(): SoundTriggerConfig {
  return {
    enabled: true,
    label: "Nueva regla",
    when: {
      kind: "hp_below",
      selector: "any_player",
      percent: 25,
    },
    action: { kind: "stop_all" },
  };
}

export function describeWhen(when: TriggerWhen): string {
  switch (when.kind) {
    case "hp_below":
      return `Cuando ${describeSelector(when.selector)} baja del ${when.percent}% HP`;
    case "round_reached":
      return `Cuando empieza la ronda ${when.round}`;
    case "condition_added":
      return `Cuando ${describeSelector(when.selector)} recibe ${when.condition}`;
    case "scene_changed":
      return `Cuando se proyecta una escena específica`;
  }
}

export function describeAction(action: TriggerAction, assetName?: string): string {
  switch (action.kind) {
    case "play_loop":
      return `Loop ${assetName ?? "(asset borrado)"}`;
    case "play_oneshot":
      return `SFX ${assetName ?? "(asset borrado)"}`;
    case "stop_loop":
      return `Cortar ${assetName ?? "loop"}`;
    case "stop_all":
      return "Cortar todo el audio";
  }
}

function describeSelector(s: CombatantSelector): string {
  switch (s) {
    case "active":
      return "el combatiente activo";
    case "any_player":
      return "cualquier PJ";
    case "any_enemy":
      return "cualquier enemigo";
    case "any":
      return "cualquier combatiente";
  }
}

import { create } from "zustand";

/**
 * Estado "vivo" no-persistido que la app comparte entre componentes para
 * que features cross-cutting (sound triggers, próximamente otras) puedan
 * reaccionar sin que el componente que produce el dato tenga que conocer
 * a quién le interesa.
 *
 * Productores actuales:
 * - DisplayPanel publica activeSceneAssetId al llamar project_scene.
 * - InitiativeTracker publica combat (combatants + round + currentTurn).
 *
 * Consumidores:
 * - useSoundTriggerEngine lee todo y dispara reglas según transiciones.
 *
 * Si el componente productor no está montado, el campo correspondiente
 * queda con su último valor — el engine no se va a equivocar porque
 * tampoco recibe eventos hasta que vuelva.
 */

export interface LiveCombatant {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  type: "player" | "enemy" | "neutral";
  conditions: string[];
}

interface LiveStateStore {
  // ── Display ─────────────────────────────────────────────────────────────
  activeSceneAssetId: string | null;
  setActiveSceneAssetId: (id: string | null) => void;

  // ── Combat ──────────────────────────────────────────────────────────────
  combatants: LiveCombatant[];
  currentTurnIndex: number;
  round: number;
  setCombatLive: (state: {
    combatants: LiveCombatant[];
    currentTurnIndex: number;
    round: number;
  }) => void;

  // ── Lifecycle ───────────────────────────────────────────────────────────
  /**
   * Llamar al cambiar de sesión: limpia combat + scene para que el engine
   * no dispare reglas con datos viejos.
   */
  resetForSession: () => void;
}

export const useLiveStateStore = create<LiveStateStore>((set) => ({
  activeSceneAssetId: null,
  combatants: [],
  currentTurnIndex: 0,
  round: 1,

  setActiveSceneAssetId: (id) => set({ activeSceneAssetId: id }),
  setCombatLive: ({ combatants, currentTurnIndex, round }) =>
    set({ combatants, currentTurnIndex, round }),
  resetForSession: () =>
    set({
      activeSceneAssetId: null,
      combatants: [],
      currentTurnIndex: 0,
      round: 1,
    }),
}));

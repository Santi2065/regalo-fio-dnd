/**
 * Mini parser de expresiones de dados D&D-style.
 *
 * Soportado:
 *   1d20            — un d20
 *   2d6+3           — dos d6 sumados + 3
 *   1d20+5 adv      — d20 con advantage (tirar 2, quedarse con el más alto)
 *   1d20+3 dis      — d20 con disadvantage
 *   4d6kh3          — 4d6, keep highest 3 (clásico para stat rolls)
 *   4d6kl3          — keep lowest 3
 *   2d20+1d6+5      — múltiples grupos sumados
 *   d20             — atajo, equivale a 1d20
 *   1d20-2          — modificadores negativos
 */

export interface DieRoll {
  sides: number;
  values: number[];
  kept: number[];
}

export interface DiceResult {
  expression: string;
  total: number;
  modifier: number;
  rolls: DieRoll[];
  advantage: "adv" | "dis" | null;
  breakdown: string;
}

export class DiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiceError";
  }
}

interface ParsedToken {
  count: number;
  sides: number;
  keep?: { mode: "high" | "low"; n: number };
}

const DIE_TOKEN = /(\d*)d(\d+)(?:k([hl])(\d+))?/gi;

function rollOne(sides: number): number {
  if (sides < 1) throw new DiceError(`Sides debe ser ≥ 1, recibido ${sides}`);
  return Math.floor(Math.random() * sides) + 1;
}

function applyKeep(values: number[], keep?: ParsedToken["keep"]): number[] {
  if (!keep) return values.slice();
  const sorted = values.slice().sort((a, b) => a - b);
  return keep.mode === "high"
    ? sorted.slice(-keep.n)
    : sorted.slice(0, keep.n);
}

/**
 * Tira la expresión y devuelve un DiceResult. Throws DiceError si la
 * expresión no parsea o queda vacía.
 */
export function rollDice(expression: string): DiceResult {
  const trimmed = expression.trim().toLowerCase();
  if (!trimmed) throw new DiceError("Expresión vacía");

  // Extraer adv/dis si están al final.
  let advantage: DiceResult["advantage"] = null;
  let body = trimmed;
  if (/\badv(antage)?\b/.test(body)) {
    advantage = "adv";
    body = body.replace(/\badv(antage)?\b/, "").trim();
  } else if (/\bdis(advantage)?\b/.test(body)) {
    advantage = "dis";
    body = body.replace(/\bdis(advantage)?\b/, "").trim();
  }

  // Extraer dice tokens.
  const diceTokens: ParsedToken[] = [];
  const matches = Array.from(body.matchAll(DIE_TOKEN));
  if (matches.length === 0) {
    throw new DiceError(`No encontré dados en "${expression}". Probá "1d20+5".`);
  }
  for (const m of matches) {
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const sides = parseInt(m[2], 10);
    let keep: ParsedToken["keep"] | undefined;
    if (m[3] && m[4]) {
      keep = { mode: m[3] === "h" ? "high" : "low", n: parseInt(m[4], 10) };
    }
    if (count < 1 || count > 100) {
      throw new DiceError(`Cantidad fuera de rango: ${count}`);
    }
    diceTokens.push({ count, sides, keep });
  }

  // Strip dice tokens del cuerpo para parsear modifiers.
  const modifierStr = body.replace(DIE_TOKEN, "").trim();
  let modifier = 0;
  if (modifierStr) {
    const modMatches = Array.from(modifierStr.matchAll(/([+-])\s*(\d+)/g));
    for (const m of modMatches) {
      const sign = m[1] === "-" ? -1 : 1;
      modifier += sign * parseInt(m[2], 10);
    }
  }

  // Tirar.
  const rolls: DieRoll[] = [];
  let diceTotal = 0;

  for (const tok of diceTokens) {
    let values: number[];
    let kept: number[];

    // Advantage/disadvantage solo aplica al primer d20 cuando no hay keep.
    const isFirst = rolls.length === 0;
    const applyAdv = advantage && isFirst && tok.sides === 20 && !tok.keep;

    if (applyAdv) {
      const a = rollOne(20);
      const b = rollOne(20);
      values = [a, b];
      kept = advantage === "adv" ? [Math.max(a, b)] : [Math.min(a, b)];
    } else {
      values = Array.from({ length: tok.count }, () => rollOne(tok.sides));
      kept = applyKeep(values, tok.keep);
    }

    rolls.push({ sides: tok.sides, values, kept });
    diceTotal += kept.reduce((a, b) => a + b, 0);
  }

  const total = diceTotal + modifier;

  // Breakdown legible: "[5, 12] + 3 = 15"
  const breakdownParts = rolls.map((r) => {
    const inner = r.values
      .map((v) => (r.kept.includes(v) ? `**${v}**` : `~~${v}~~`))
      .join(", ");
    return r.values.length === 1 ? `${r.values[0]}` : `[${inner}]`;
  });
  const modPart = modifier !== 0 ? ` ${modifier > 0 ? "+" : ""}${modifier}` : "";
  const advPart = advantage ? ` (${advantage})` : "";
  const breakdown = `${breakdownParts.join(" + ")}${modPart}${advPart} = ${total}`;

  return {
    expression: expression.trim(),
    total,
    modifier,
    rolls,
    advantage,
    breakdown,
  };
}

/** Atajos comunes para el roller. */
export const DICE_PRESETS: { label: string; expression: string }[] = [
  { label: "d20", expression: "1d20" },
  { label: "d20 + advantage", expression: "1d20 adv" },
  { label: "d20 + disadvantage", expression: "1d20 dis" },
  { label: "d4", expression: "1d4" },
  { label: "d6", expression: "1d6" },
  { label: "d8", expression: "1d8" },
  { label: "d10", expression: "1d10" },
  { label: "d12", expression: "1d12" },
  { label: "d100 (porcentaje)", expression: "1d100" },
  { label: "Stat roll (4d6 keep highest 3)", expression: "4d6kh3" },
];

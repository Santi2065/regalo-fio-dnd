import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { rollDice, DiceError, DICE_PRESETS, type DiceResult } from "../lib/dice";
import { KeyboardKey } from "./ui";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface HistoryEntry {
  result: DiceResult;
  ts: number;
}

const HISTORY_LIMIT = 10;

export default function DiceOverlay({ open, onClose }: Props) {
  const [expression, setExpression] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setExpression("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const tryRoll = (expr: string) => {
    const trimmed = expr.trim();
    if (!trimmed) return;
    try {
      const result = rollDice(trimmed);
      setHistory((prev) => [{ result, ts: Date.now() }, ...prev].slice(0, HISTORY_LIMIT));
      setError(null);
      setExpression("");
    } catch (e) {
      if (e instanceof DiceError) setError(e.message);
      else setError(String(e));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    tryRoll(expression);
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] flex items-start justify-center pt-[12vh] px-4 animate-backdrop-in"
      role="dialog"
      aria-modal="true"
      aria-label="Tirar dados"
    >
      <div className="absolute inset-0 bg-parchment-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-parchment-900 border border-parchment-700 rounded-xl shadow-candlelight animate-modal-in flex flex-col max-h-[80vh] overflow-hidden">
        {/* Input */}
        <form onSubmit={handleSubmit} className="flex items-center gap-3 px-4 py-3 border-b border-parchment-800 flex-shrink-0">
          <span className="text-gold-400 text-lg" aria-hidden>
            🎲
          </span>
          <input
            ref={inputRef}
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            placeholder="ej: 1d20+5 adv  ·  2d6+3  ·  4d6kh3"
            className="flex-1 bg-transparent border-none text-vellum-50 placeholder-vellum-400 focus:outline-none text-base font-mono"
          />
          <button
            type="submit"
            disabled={!expression.trim()}
            className="px-3 py-1 rounded-md bg-gold-600 hover:bg-gold-500 disabled:opacity-40 text-parchment-950 text-sm font-medium"
          >
            Tirar
          </button>
        </form>

        {error && (
          <div className="px-4 py-2 bg-danger-900/40 border-b border-danger-700 text-danger-300 text-xs">
            {error}
          </div>
        )}

        {/* Body: history + presets */}
        <div className="flex-1 overflow-y-auto">
          {history.length > 0 && (
            <div className="px-4 py-3 border-b border-parchment-800">
              <p className="text-[10px] text-vellum-400 uppercase tracking-wider mb-2">
                Tiradas recientes
              </p>
              <ul className="space-y-2">
                {history.map((entry, idx) => (
                  <li
                    key={`${entry.ts}-${idx}`}
                    className={`flex items-baseline justify-between gap-3 ${
                      idx === 0 ? "text-vellum-50" : "text-vellum-300"
                    }`}
                  >
                    <div className="flex items-baseline gap-2 min-w-0 flex-1">
                      <span className="font-mono text-xs text-vellum-400 flex-shrink-0">
                        {entry.result.expression}
                      </span>
                      <span className="font-mono text-[11px] text-vellum-500 truncate">
                        {entry.result.breakdown}
                      </span>
                    </div>
                    <span
                      className={`font-bold tabular-nums flex-shrink-0 ${
                        idx === 0 ? "text-2xl text-gold-300" : "text-base text-vellum-200"
                      }`}
                    >
                      {entry.result.total}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="px-4 py-3">
            <p className="text-[10px] text-vellum-400 uppercase tracking-wider mb-2">
              Presets
            </p>
            <div className="flex flex-wrap gap-1.5">
              {DICE_PRESETS.map((p) => (
                <button
                  key={p.expression}
                  onClick={() => tryRoll(p.expression)}
                  className="px-2.5 py-1 rounded-md text-xs bg-parchment-800 hover:bg-parchment-700 text-vellum-200 transition-colors"
                  title={`Tirar ${p.expression}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer hints */}
        <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-parchment-800 flex-shrink-0 text-[10px] text-vellum-400">
          <div className="flex gap-3">
            <span>
              <KeyboardKey size="sm">↵</KeyboardKey> tirar
            </span>
            <span>
              <KeyboardKey size="sm">Esc</KeyboardKey> cerrar
            </span>
          </div>
          <span className="text-vellum-500 font-mono">XdY · adv · kh · kl</span>
        </div>
      </div>
    </div>,
    document.body
  );
}

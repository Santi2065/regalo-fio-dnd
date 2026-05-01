import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  GENERATORS,
  type Generator,
  type GeneratorResult,
  generatorResultToMarkdown,
} from "../lib/generators";
import { toast } from "../lib/toast";
import { KeyboardKey, Button } from "./ui";

interface Props {
  open: boolean;
  sessionId: string | null;
  onClose: () => void;
}

export default function GeneratorOverlay({ open, sessionId, onClose }: Props) {
  const [active, setActive] = useState<Generator | null>(null);
  const [result, setResult] = useState<GeneratorResult | null>(null);
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    if (open) {
      setActive(null);
      setResult(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (result) {
          // First Esc clears the result and goes back to picker.
          setResult(null);
          setActive(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, result]);

  const runGenerator = (gen: Generator) => {
    setActive(gen);
    setResult(gen.generate());
  };

  const reroll = () => {
    if (active) setResult(active.generate());
  };

  const saveToNotes = async () => {
    if (!result || !sessionId) return;
    setSavingNote(true);
    try {
      await invoke("create_note", {
        sessionId,
        title: `${result.generatorLabel}: ${result.title}`,
        content: generatorResultToMarkdown(result),
      });
      toast.success("Guardado a notas");
      onClose();
    } catch (e) {
      console.error("[GeneratorOverlay] save note failed", e);
      toast.error("No se pudo guardar la nota");
    } finally {
      setSavingNote(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] flex items-start justify-center pt-[12vh] px-4 animate-backdrop-in"
      role="dialog"
      aria-modal="true"
      aria-label="Generador random"
    >
      <div className="absolute inset-0 bg-parchment-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-parchment-900 border border-parchment-700 rounded-xl shadow-candlelight animate-modal-in flex flex-col max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-parchment-800 flex-shrink-0">
          <span className="text-gold-400 text-lg" aria-hidden>
            🎲
          </span>
          <h2 className="font-display text-base text-vellum-100 flex-1">
            {result ? `${result.generatorLabel} random` : "Generar"}
          </h2>
          {result && active && (
            <Button variant="secondary" size="sm" onClick={reroll}>
              Otra
            </Button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {!result ? (
            <div className="p-4 grid grid-cols-2 gap-2">
              {GENERATORS.map((g) => (
                <button
                  key={g.id}
                  onClick={() => runGenerator(g)}
                  className="flex items-center gap-3 p-3 rounded-lg border border-parchment-700 hover:border-gold-600 hover:bg-parchment-800/40 transition-colors text-left"
                >
                  <span className="text-2xl flex-shrink-0">{g.icon}</span>
                  <div>
                    <div className="text-sm font-medium text-vellum-100">{g.label}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-5 space-y-3">
              <h3 className="font-display text-xl text-gold-300 leading-tight">
                {result.title}
              </h3>
              {result.lines.length > 0 && (
                <dl className="space-y-2">
                  {result.lines.map((l, i) => (
                    <div key={i} className="flex gap-3 text-sm">
                      <dt className="text-vellum-400 w-24 flex-shrink-0">{l.label}</dt>
                      <dd className="text-vellum-100 flex-1">{l.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-parchment-800 flex-shrink-0">
          {result ? (
            <>
              <button
                onClick={() => {
                  setResult(null);
                  setActive(null);
                }}
                className="text-xs text-vellum-400 hover:text-vellum-100 transition-colors"
              >
                ← Otra categoría
              </button>
              <Button
                variant="primary"
                size="sm"
                onClick={saveToNotes}
                disabled={!sessionId || savingNote}
                loading={savingNote}
                iconBefore="📝"
              >
                Guardar a notas
              </Button>
            </>
          ) : (
            <span className="text-[10px] text-vellum-400">
              <KeyboardKey size="sm">Esc</KeyboardKey> cerrar
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

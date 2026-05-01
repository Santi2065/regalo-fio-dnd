import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { searchManuals, type SearchHit } from "../lib/manuals";
import { KeyboardKey } from "./ui";
import ManualPageViewer from "./ManualPageViewer";

interface Props {
  open: boolean;
  onClose: () => void;
}

const DEBOUNCE_MS = 200;

function highlight(text: string, query: string): string {
  // Simple case-insensitive truncation around the first match for preview.
  const lower = text.toLowerCase();
  const q = query.toLowerCase().trim();
  const idx = q ? lower.indexOf(q.split(/\s+/)[0]) : -1;
  if (idx < 0) return text.length > 240 ? text.slice(0, 240) + "…" : text;
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + 200);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end) + suffix;
}

export default function ManualSearch({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [viewerHit, setViewerHit] = useState<SearchHit | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setHits([]);
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      searchManuals(query, 10)
        .then((rows) => {
          setHits(rows);
          setActiveIdx(0);
        })
        .catch((e) => {
          console.error("[ManualSearch] failed", e);
          setHits([]);
        })
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  // Keyboard nav
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // If the viewer is open, the viewer's own Esc handler closes it.
        // Don't close the search overlay too — let it handle its own.
        if (viewerHit) return;
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, hits.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const hit = hits[activeIdx];
        if (hit) {
          e.preventDefault();
          setViewerHit(hit);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hits, activeIdx, onClose, viewerHit]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] flex items-start justify-center pt-[12vh] px-4 animate-backdrop-in"
      role="dialog"
      aria-modal="true"
      aria-label="Buscar en manuales"
    >
      <div className="absolute inset-0 bg-parchment-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-parchment-900 border border-parchment-700 rounded-xl shadow-candlelight animate-modal-in flex flex-col max-h-[70vh] overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-parchment-800 flex-shrink-0">
          <span className="text-gold-400 text-lg">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Preguntá algo del manual..."
            className="flex-1 bg-transparent border-none text-vellum-50 placeholder-vellum-400 focus:outline-none text-base"
          />
          {loading && (
            <span className="inline-block w-3 h-3 border-2 border-gold-500 border-t-transparent rounded-full animate-spin" />
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {query.trim().length < 2 ? (
            <p className="text-vellum-400 text-sm text-center py-12 px-6">
              Tipeá al menos 2 letras para buscar.
            </p>
          ) : !loading && hits.length === 0 ? (
            <p className="text-vellum-400 text-sm text-center py-12 px-6">
              Sin resultados. Probá con palabras distintas o asegurate de tener
              manuales indexados.
            </p>
          ) : (
            <ul className="divide-y divide-parchment-800">
              {hits.map((hit, idx) => (
                <li
                  key={`${hit.manual_id}-${hit.page_number}-${idx}`}
                  className={`px-4 py-3 cursor-pointer transition-colors ${
                    idx === activeIdx
                      ? "bg-parchment-800/80"
                      : "hover:bg-parchment-800/40"
                  }`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => setViewerHit(hit)}
                >
                  <div className="flex items-center gap-2 text-xs text-vellum-300 mb-1">
                    <span className="text-gold-300">📖 {hit.manual_name}</span>
                    <span className="text-vellum-500">·</span>
                    <span>pág. {hit.page_number}</span>
                    {hit.section_path && (
                      <>
                        <span className="text-vellum-500">·</span>
                        <span className="truncate">{hit.section_path}</span>
                      </>
                    )}
                  </div>
                  <p className="text-sm text-vellum-100 leading-snug line-clamp-3">
                    {highlight(hit.text, query)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-parchment-800 flex-shrink-0 text-[10px] text-vellum-400">
          <div className="flex gap-3">
            <span>
              <KeyboardKey size="sm">↑↓</KeyboardKey> navegar
            </span>
            <span>
              <KeyboardKey size="sm">↵</KeyboardKey> abrir
            </span>
            <span>
              <KeyboardKey size="sm">Esc</KeyboardKey> cerrar
            </span>
          </div>
          <span className="text-vellum-500">Búsqueda local · híbrida</span>
        </div>
      </div>

      <ManualPageViewer
        open={viewerHit !== null}
        manualName={viewerHit?.manual_name ?? ""}
        filePath={viewerHit?.manual_file_path ?? ""}
        pageNumber={viewerHit?.page_number ?? 1}
        onClose={() => setViewerHit(null)}
      />
    </div>,
    document.body
  );
}

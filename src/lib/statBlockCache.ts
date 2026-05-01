import { useEffect, useState } from "react";
import { create } from "zustand";
import { getStatBlockByName, type StatBlock } from "./manuals";

/**
 * Cache global de stat blocks por nombre. Evita pegarle al backend cada vez
 * que un combatiente con el mismo nombre se renderiza. Se invalida cuando
 * un manual se borra (TODO: invalidación selectiva — por ahora hot-reload
 * basta porque el cache está en memoria y no persiste).
 */

interface StatBlockCache {
  // null en el value significa "ya pregunté y no hay match" — no re-pedimos.
  byKey: Map<string, StatBlock | null>;
  inflight: Set<string>;
  set: (key: string, value: StatBlock | null) => void;
  markInflight: (key: string) => void;
  clearInflight: (key: string) => void;
  clear: () => void;
}

const useStatBlockCache = create<StatBlockCache>((set) => ({
  byKey: new Map(),
  inflight: new Set(),
  set: (key, value) =>
    set((s) => {
      const next = new Map(s.byKey);
      next.set(key, value);
      const inf = new Set(s.inflight);
      inf.delete(key);
      return { byKey: next, inflight: inf };
    }),
  markInflight: (key) =>
    set((s) => {
      const inf = new Set(s.inflight);
      inf.add(key);
      return { inflight: inf };
    }),
  clearInflight: (key) =>
    set((s) => {
      const inf = new Set(s.inflight);
      inf.delete(key);
      return { inflight: inf };
    }),
  clear: () => set({ byKey: new Map(), inflight: new Set() }),
}));

const normalizeKey = (name: string) => name.trim().toLowerCase();

/**
 * Hook React: dado el nombre de un combatiente, devuelve el StatBlock
 * matcheado o null. Hace 1 request al backend max por nombre por sesión.
 */
export function useStatBlock(name: string | null | undefined): {
  statBlock: StatBlock | null;
  loading: boolean;
} {
  const key = name ? normalizeKey(name) : "";
  const cached = useStatBlockCache((s) => (key ? s.byKey.get(key) ?? undefined : undefined));
  const inflight = useStatBlockCache((s) => (key ? s.inflight.has(key) : false));
  const setCached = useStatBlockCache((s) => s.set);
  const markInflight = useStatBlockCache((s) => s.markInflight);
  const clearInflight = useStatBlockCache((s) => s.clearInflight);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!key) return;
    if (cached !== undefined) return;
    if (inflight) return;
    markInflight(key);
    setLoading(true);
    getStatBlockByName(name as string)
      .then((sb) => setCached(key, sb))
      .catch((e) => {
        console.error("[useStatBlock] failed", e);
        clearInflight(key);
      })
      .finally(() => setLoading(false));
  }, [key, name, cached, inflight, setCached, markInflight, clearInflight]);

  return {
    statBlock: cached ?? null,
    loading: inflight || loading,
  };
}

/** Limpia todo el cache. Llamar después de borrar un manual. */
export const clearStatBlockCache = () => useStatBlockCache.getState().clear();

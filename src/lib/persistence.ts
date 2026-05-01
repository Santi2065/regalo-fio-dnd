/**
 * Tiny localStorage wrappers with try/catch and JSON parsing baked in.
 * Used for UI prefs (panel size, last tab) and crash-recovery backups.
 *
 * Storage failures (full / disabled / private mode) are silently swallowed —
 * caller gets back the default. None of these helpers throw.
 */

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

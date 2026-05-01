const LOCALE = "es-AR";

/** "5 may 2026" */
export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** "5 may" — for compact lists */
export function formatDateCompact(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, {
    month: "short",
    day: "numeric",
  });
}

/** "5/5/2026 14:32" */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(LOCALE);
}

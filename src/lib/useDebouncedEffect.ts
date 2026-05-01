import { useEffect, useRef } from "react";

/**
 * Run `fn` after `ms` of inactivity on `deps`. Each new dependency change
 * resets the timer. The pending timer is cleared on unmount (so trailing
 * writes after teardown don't fire).
 *
 * Pass `enabled=false` to skip running entirely (e.g. while loading).
 *
 * Note: this drops the pending call on unmount. If you need the trailing
 * write to commit before unmount (e.g. flush on session change), do it
 * yourself in a separate cleanup.
 */
export function useDebouncedEffect(
  fn: () => void,
  deps: React.DependencyList,
  ms: number,
  enabled: boolean = true
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(fn, ms);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, ms]);
}

export const DEFAULT_HISTORY_DAYS = 84;

/** Widest window the grid offers, so a crafted `days` can't ask for years. */
export const MAX_HISTORY_DAYS = 371;

/**
 * Length of a routine-history window from untrusted input. Anything that is
 * not a finite number falls back to the default; a finite value is truncated
 * and clamped to 1..MAX_HISTORY_DAYS.
 */
export function clampHistoryDays(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n)
    ? Math.min(Math.max(Math.trunc(n), 1), MAX_HISTORY_DAYS)
    : DEFAULT_HISTORY_DAYS;
}

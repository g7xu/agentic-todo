/**
 * Duration parsing and formatting — durations are stored as total minutes
 * (`Task.estimate`, `Task.timeUsed`) and shown as "1h 30m" (docs/ESTIMATES.md §3.2).
 *
 * `parseDuration` accepts every notation people reach for rather than forcing one
 * (DE1). It replaced a strict "HH:MM" input where `30`, `1h30`, and `90m` were all
 * rejected with nothing but a red border to explain why.
 */

/** "1:30" → 90. Kept so durations typed before this control still parse. */
const HH_MM = /^(\d{1,3}):([0-5]\d)$/;

/** "2h", "1.5h", "1h30", "1h 30m", "2 hours" — hours, with optional trailing minutes. */
const HOURS = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)(?:\s*(\d+)\s*(?:m|min|mins|minute|minutes)?)?$/;

/** "30m", "30 min", "45 minutes" — minutes with an explicit unit. */
const MINUTES = /^(\d+)\s*(?:m|min|mins|minute|minutes)$/;

/** "30" — a bare number means minutes, which is what people type most. */
const BARE = /^(\d+)$/;

/**
 * Total minutes, or null if the text isn't a duration. Empty is null too — an
 * empty field means "clear this", not "zero".
 *
 * Syntax only: bounds are the caller's business, since `estimate` caps at 24h
 * while `timeUsed` allows 99:59 (DE3).
 */
export function parseDuration(text: string): number | null {
  const s = text.trim().toLowerCase();
  if (s === "") return null;

  const hhmm = HH_MM.exec(s);
  if (hhmm) return Number(hhmm[1]) * 60 + Number(hhmm[2]);

  const hours = HOURS.exec(s);
  // Fractional hours ("1.5h") can land off a whole minute, so round rather than
  // truncate — 0.51h should be 31m, not 30m.
  if (hours) return Math.round(Number(hours[1]) * 60) + Number(hours[2] ?? 0);

  const minutes = MINUTES.exec(s) ?? BARE.exec(s);
  if (minutes) return Number(minutes[1]);

  return null;
}

/** 90 → "1h 30m", 45 → "45m", 120 → "2h", 0 → "0m". */
export function formatDuration(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Total estimated minutes across tasks. Tasks without an estimate contribute
 * nothing, which is why every total is shown as a "~" lower bound (DE5) — a
 * guessed default would make the number look complete when it isn't.
 */
export function sumEstimates(tasks: { estimate: number | null }[]): number {
  return tasks.reduce((sum, t) => sum + (t.estimate ?? 0), 0);
}

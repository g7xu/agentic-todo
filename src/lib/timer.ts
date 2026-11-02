/**
 * Arithmetic for task timers (docs/TIMERS.md). Shared by the data layer, which
 * turns a session into minutes, and the client, which counts a running one up.
 */
import { dateStrInTz } from "@/lib/date";

/** A stop past this many minutes asks the user when work really ended (DT4). */
export const LONG_RUN_MINUTES = 180;

/** `Task.timeUsed`'s upper bound (ESTIMATES DE3); a stop clamps to it (DT6). */
export const TIME_USED_MAX = 5999;

/**
 * Whole minutes in a session, rounded to nearest. Anything under one minute is
 * 0, which callers treat as a misclick and discard: recording it would mark an
 * untimed task as timed (DT6).
 */
export function sessionMinutes(startedAt: Date, endedAt: Date): number {
  const ms = endedAt.getTime() - startedAt.getTime();
  if (ms < 60_000) return 0;
  return Math.round(ms / 60_000);
}

/** 1122 → "18:42", 4925 → "1:22:05". Negative input reads as 0. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  if (h === 0) return `${m}:${ss}`;
  return `${h}:${String(m).padStart(2, "0")}:${ss}`;
}

/**
 * True when stopping at `endedAt` should ask before recording: the session ran
 * longer than LONG_RUN_MINUTES, or it spans the user's local midnight. The
 * second catches a timer left overnight even when it's short of the threshold.
 */
export function needsStopReview(
  startedAt: Date,
  endedAt: Date,
  tz: string,
): boolean {
  if (endedAt.getTime() - startedAt.getTime() > LONG_RUN_MINUTES * 60_000) {
    return true;
  }
  return dateStrInTz(startedAt, tz) !== dateStrInTz(endedAt, tz);
}

import { startOfWeek } from "@/lib/date";
import type { NoteKind } from "@/lib/types";

/** Board columns, left to right. */
export const NOTE_KINDS = ["thorn", "rose", "seed", "action"] as const satisfies readonly NoteKind[];

/** Closing a week carries at most this many action notes into tasks. */
export const MAX_CARRIED = 3;

/** True when `dateStr` is the Sunday a review week is keyed by. */
export function isWeekStart(dateStr: string): boolean {
  return startOfWeek(dateStr) === dateStr;
}

const MONTH = (d: Date) => d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

/** "Oct 25 – 31", or "Nov 29 – Dec 5" when the week crosses a month. */
export function weekLabel(week: string): string {
  const start = new Date(`${week}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const tail =
    MONTH(end) === MONTH(start)
      ? `${end.getUTCDate()}`
      : `${MONTH(end)} ${end.getUTCDate()}`;
  return `${MONTH(start)} ${start.getUTCDate()} – ${tail}`;
}

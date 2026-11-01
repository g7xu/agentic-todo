import type { CapacityDTO } from "@/lib/types";

/** A day's budget set against its load, all in minutes (docs/CAPACITY.md). */
export type DayLoad = {
  /** Null when the day has neither an override nor a default (DC1). */
  available: number | null;
  /** Completed work: `timeUsed`, else `estimate` (DC3). */
  done: number;
  /** Estimates of what is still open, routine occurrences included. */
  planned: number;
  /** Items that contribute nothing because they carry no duration (DC4). */
  unestimated: number;
  /** `available − done − planned`; negative when over, null with `available`. */
  free: number | null;
};

/** The day's override if it has one — `0` included — else the default. */
export function availableOn(date: string, capacity: CapacityDTO): number | null {
  return capacity.days[date] ?? capacity.defaultMinutes;
}

export function dayLoad(
  available: number | null,
  open: { estimate: number | null }[],
  completed: { estimate: number | null; timeUsed: number | null }[],
): DayLoad {
  let planned = 0;
  let done = 0;
  let unestimated = 0;
  for (const t of open) {
    if (t.estimate === null) unestimated++;
    else planned += t.estimate;
  }
  for (const t of completed) {
    const spent = t.timeUsed ?? t.estimate;
    if (spent === null) unestimated++;
    else done += spent;
  }
  return {
    available,
    done,
    planned,
    unestimated,
    free: available === null ? null : available - done - planned,
  };
}

/** Hour-sized presets; a working day doesn't cluster like a task does. */
export const CAPACITY_PRESETS = [120, 240, 360, 480];

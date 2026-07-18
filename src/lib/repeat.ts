/**
 * Routine cadence rules (docs/ROUTINES.md §4.2) — pure calendar math over
 * 'YYYY-MM-DD' strings, shared by the materialization engine (server) and the
 * routine dialog (client). No DB, no `Date.now()`: every function takes the
 * user-local days it needs, so behavior is timezone-correct by construction.
 */

import {
  addDays,
  addMonthsClamped,
  dayOfMonth,
  daysInMonth,
  diffDays,
  diffMonths,
  startOfWeek,
  weekdayOf,
} from "@/lib/date";
import type { RoutineRepeatBase, RoutineRepeatUnit } from "@/lib/types";

export const REPEAT_UNITS: { value: RoutineRepeatUnit; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "weekday", label: "Weekday" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

/** Upper bound on `repeatEvery` per unit. 'weekday' is pinned to 1: "every
 * weekday" means Mon-Fri, and no other multiple is offered (owner decision). */
export const MAX_EVERY: Record<RoutineRepeatUnit, number> = {
  day: 365,
  week: 52,
  weekday: 1,
  month: 24,
  year: 10,
};

export const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

export function isRepeatUnit(v: string): v is RoutineRepeatUnit {
  return REPEAT_UNITS.some((u) => u.value === v);
}

/** Mon-Fri. */
function isWorkday(dateStr: string): boolean {
  const d = weekdayOf(dateStr);
  return d >= 1 && d <= 5;
}

export type RepeatSpec = {
  repeatEvery: number;
  repeatUnit: RoutineRepeatUnit;
  repeatWeekdays: number[];
  repeatBase: RoutineRepeatBase;
  startDate: string;
  endDate: string | null;
};

/**
 * Collapse a repeat spec to its canonical form so the engine never has to
 * second-guess irrelevant fields. Applied on every write (UI, actions, and
 * later the agent tools), so stored rows are always already canonical:
 *
 *  - 'weekday' pins `repeatEvery` to 1 (see MAX_EVERY);
 *  - weekdays only mean something for a scheduled-based 'week' routine — a
 *    completed-based one is "N weeks after I finish it", which a weekday list
 *    contradicts (owner decision), so it is cleared;
 *  - an empty weekday list falls back to the anchor's own weekday, which is
 *    what "every week" means with nothing ticked.
 */
export function normalizeRepeat<T extends Partial<RepeatSpec>>(
  spec: T,
  anchor: string,
): T {
  const unit = spec.repeatUnit;
  if (unit === undefined) return spec;

  const out = { ...spec };
  // MAX_EVERY.weekday is 1, so this clamp is also what pins "every weekday".
  out.repeatEvery = Math.min(
    Math.max(Math.trunc(spec.repeatEvery ?? 1) || 1, 1),
    MAX_EVERY[unit],
  );

  if (unit !== "week" || spec.repeatBase === "completed") {
    out.repeatWeekdays = [];
  } else {
    const days = [...new Set(spec.repeatWeekdays ?? [])].filter(
      (d) => Number.isInteger(d) && d >= 0 && d <= 6,
    );
    out.repeatWeekdays = days.length > 0 ? days.sort() : [weekdayOf(anchor)];
  }
  return out;
}

/**
 * Does `today` (user-local) fall on this routine's cadence?
 *
 * `lastCompletionDay` is the user-local day of the newest completed instance,
 * or null if it has never been completed — only read for completed-based
 * routines, where the cadence measures forward from that day rather than from
 * the `startDate` grid. A completed-based routine with no completion yet is
 * due from `startDate` onward (its first occurrence), which is also why an
 * unfinished instance carrying forward is not a bug: it *is* that occurrence.
 *
 * `endDate` is inclusive and stops new occurrences only (docs/ROUTINES.md §4.1).
 */
export function isDueOn(
  r: RepeatSpec,
  today: string,
  lastCompletionDay: string | null,
): boolean {
  if (today < r.startDate) return false;
  if (r.endDate && today > r.endDate) return false;

  if (r.repeatBase === "completed") {
    // Weekday routines never land on a weekend, including their first day.
    if (r.repeatUnit === "weekday" && !isWorkday(today)) return false;
    if (!lastCompletionDay) return true;

    const since = diffDays(lastCompletionDay, today);
    switch (r.repeatUnit) {
      case "day":
        return since >= r.repeatEvery;
      case "week":
        return since >= r.repeatEvery * 7;
      case "weekday":
        return since >= 1;
      case "month":
        return today >= addMonthsClamped(lastCompletionDay, r.repeatEvery);
      case "year":
        return today >= addMonthsClamped(lastCompletionDay, r.repeatEvery * 12);
    }
  }

  switch (r.repeatUnit) {
    case "day":
      return diffDays(r.startDate, today) % r.repeatEvery === 0;
    case "weekday":
      return isWorkday(today);
    case "week": {
      // Weeks are counted from the Sunday of the anchor's week, so the anchor
      // week is week 0 and ticked days earlier in it are simply already past.
      const weeks = diffDays(startOfWeek(r.startDate), today) / 7;
      if (Math.floor(weeks) % r.repeatEvery !== 0) return false;
      return r.repeatWeekdays.includes(weekdayOf(today));
    }
    case "month":
      if (diffMonths(r.startDate, today) % r.repeatEvery !== 0) return false;
      return dayOfMonth(today) === clampedDay(r.startDate, today);
    case "year": {
      const years = Number(today.slice(0, 4)) - Number(r.startDate.slice(0, 4));
      if (years % r.repeatEvery !== 0) return false;
      if (today.slice(5, 7) !== r.startDate.slice(5, 7)) return false;
      return dayOfMonth(today) === clampedDay(r.startDate, today);
    }
  }
}

/**
 * Every day in `[from, to]` (inclusive) this routine is due on — used by the
 * Upcoming board to preview a week of routines without materializing them
 * (docs/ROUTINES.md §RV5). Instances stay today-only in the DB; these are
 * projections, so they cost nothing and correct themselves the moment the
 * template is edited.
 *
 * Completed-based routines return `[]`: their cadence measures forward from
 * the last completion, so any date past the current occurrence is a guess that
 * would visibly jump the instant the user ticks the box. Better to show
 * nothing than a date we'd have to retract.
 */
export function occurrencesBetween(
  r: RepeatSpec,
  from: string,
  to: string,
): string[] {
  if (r.repeatBase === "completed") return [];
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    // lastCompletionDay is irrelevant for scheduled-based cadences, which read
    // only the startDate grid.
    if (isDueOn(r, d, null)) out.push(d);
  }
  return out;
}

/** The anchor's day of month, pulled back to the last day of `today`'s month
 * when it doesn't exist there (Jan 31 → Feb 28/29; Feb 29 → Feb 28). */
function clampedDay(startDate: string, today: string): number {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return Math.min(dayOfMonth(startDate), daysInMonth(year, month));
}

function plural(n: number, unit: string): string {
  return n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
}

function monthDayLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}

/** One-line cadence summary for the routines list — "Every 2 weeks on Mon,
 * Wed · until Jul 20". */
export function cadenceLabel(r: RepeatSpec): string {
  let every: string;
  switch (r.repeatUnit) {
    case "day":
      every = plural(r.repeatEvery, "day");
      break;
    case "weekday":
      every = "Every weekday";
      break;
    case "week": {
      every = plural(r.repeatEvery, "week");
      if (r.repeatBase !== "completed" && r.repeatWeekdays.length > 0) {
        const days = r.repeatWeekdays
          .map((d) => WEEKDAYS[d].label)
          .join(", ");
        every += ` on ${days}`;
      }
      break;
    }
    case "month":
      every = `${plural(r.repeatEvery, "month")} on the ${ordinal(dayOfMonth(r.startDate))}`;
      break;
    case "year":
      every = `${plural(r.repeatEvery, "year")} on ${monthDayLabel(r.startDate)}`;
      break;
  }

  const base = r.repeatBase === "completed" ? " · after completion" : "";
  const ends = r.endDate ? ` · until ${monthDayLabel(r.endDate)}` : "";
  return every + base + ends;
}

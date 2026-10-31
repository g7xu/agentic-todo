import { dateStrInTz, dbDateToStr } from "@/lib/date";

/**
 * Estimate vs. actual (docs/ESTIMATE-VS-ACTUAL.md): per project, the minutes
 * finished work was estimated at against the minutes logged for it.
 *
 * Each completed row is placed on a user-local day, and the day decides
 * whether it is inside the window (EA2):
 *  - a routine day belongs to the day it was due, the same day the Activity
 *    grid draws it on, even when it was made up later;
 *  - an ordinary task belongs to the day it was completed, in the user's
 *    timezone.
 *
 * Only rows with both a positive `estimate` and a positive `timeUsed` are
 * compared (EA3). A zero on either side has no meaningful ratio, and a missing
 * one would have to be guessed; both are left out and show up only as the gap
 * between `timed` and `done`.
 */

/** Below this many compared tasks a project is shown but not judged (EA5). */
export const MIN_TASKS = 5;

/** Within this fraction of the estimate, a project counts as on plan. */
export const ON_PLAN = 0.15;

export type CompletedRow = {
  id: string;
  content: string;
  projectId: string;
  routineId: string | null;
  estimate: number | null;
  timeUsed: number | null;
  dueDate: Date | null;
  completedAt: Date | null;
};

export type Miss = {
  id: string;
  content: string;
  routine: boolean;
  estimate: number;
  timeUsed: number;
};

export type ProjectAccuracy = {
  projectId: string;
  tasks: number;
  estimatedMinutes: number;
  usedMinutes: number;
  /** The compared task furthest from its estimate, in minutes either way. */
  biggestMiss: Miss;
};

export type Accuracy = {
  /** Completed rows in the window, compared or not. */
  done: number;
  /** Of those, the rows with both numbers. */
  timed: number;
  /** Judged projects (MIN_TASKS or more) first, each group by estimate. */
  projects: ProjectAccuracy[];
};

/** The user-local day a completed row counts on, or null if it has no day. */
export function dayOf(row: CompletedRow, tz: string): string | null {
  if (row.routineId !== null) return dbDateToStr(row.dueDate);
  return row.completedAt ? dateStrInTz(row.completedAt, tz) : null;
}

export function isTimed(
  row: Pick<CompletedRow, "estimate" | "timeUsed">,
): boolean {
  return (row.estimate ?? 0) > 0 && (row.timeUsed ?? 0) > 0;
}

function missSize(m: Miss): number {
  return Math.abs(m.timeUsed - m.estimate);
}

function biggerMiss(a: Miss, b: Miss): Miss {
  return missSize(b) > missSize(a) ||
    (missSize(b) === missSize(a) &&
      (b.estimate > a.estimate || (b.estimate === a.estimate && b.id < a.id)))
    ? b
    : a;
}

export function summarizeAccuracy(
  rows: CompletedRow[],
  from: string,
  to: string,
  tz: string,
): Accuracy {
  let done = 0;
  let timed = 0;
  const byProject = new Map<string, ProjectAccuracy>();

  for (const row of rows) {
    const day = dayOf(row, tz);
    if (day === null || day < from || day > to) continue;
    done++;
    if (!isTimed(row)) continue;
    timed++;

    const miss: Miss = {
      id: row.id,
      content: row.content,
      routine: row.routineId !== null,
      estimate: row.estimate!,
      timeUsed: row.timeUsed!,
    };
    const p = byProject.get(row.projectId);
    if (!p) {
      byProject.set(row.projectId, {
        projectId: row.projectId,
        tasks: 1,
        estimatedMinutes: miss.estimate,
        usedMinutes: miss.timeUsed,
        biggestMiss: miss,
      });
      continue;
    }
    p.tasks++;
    p.estimatedMinutes += miss.estimate;
    p.usedMinutes += miss.timeUsed;
    p.biggestMiss = biggerMiss(p.biggestMiss, miss);
  }

  const judged = (p: ProjectAccuracy) => (p.tasks >= MIN_TASKS ? 0 : 1);
  const projects = [...byProject.values()].sort(
    (a, b) =>
      judged(a) - judged(b) ||
      b.estimatedMinutes - a.estimatedMinutes ||
      a.projectId.localeCompare(b.projectId),
  );
  return { done, timed, projects };
}

/** Whether logged time sits within ON_PLAN of the estimate, either way. */
export function onPlan(p: Pick<ProjectAccuracy, "estimatedMinutes" | "usedMinutes">): boolean {
  const ratio = p.usedMinutes / p.estimatedMinutes;
  return ratio >= 1 - ON_PLAN && ratio <= 1 + ON_PLAN;
}

/** 45 → "45m", 60 → "1h", 258 → "4.3h": one decimal is as precise as a
 * hand-logged total deserves, and it keeps "of" pairs short at phone width. */
export function formatHours(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const tenths = Math.round(minutes / 6) / 10;
  return `${Number.isInteger(tenths) ? tenths : tenths.toFixed(1)}h`;
}

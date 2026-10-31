import { dateStrInTz, dbDateToStr } from "@/lib/date";

/**
 * Time by project (docs/TIME-BY-PROJECT.md): how the minutes of finished work
 * split across projects over a window of days.
 *
 * Each row in the input is one completed task. A row is placed on a user-local
 * day before it is counted, and the day decides whether it is inside the
 * window:
 *  - a routine day belongs to the day it was due, the same day the Activity
 *    grid draws it on, even when it was made up later (DT2);
 *  - an ordinary task belongs to the day it was completed, in the user's
 *    timezone (DT2).
 *
 * Minutes are `estimate` only (DT3). A null estimate contributes nothing and
 * is counted in `unestimated` instead, so the share is a share of the
 * estimated minutes and every total is a lower bound (docs/ESTIMATES.md DE5).
 * `timeUsed` is summed separately and never mixed into the share.
 */

export type CompletedRow = {
  projectId: string;
  routineId: string | null;
  estimate: number | null;
  timeUsed: number | null;
  dueDate: Date | null;
  completedAt: Date | null;
};

export type ProjectTimeShare = {
  projectId: string;
  tasks: number;
  estimatedMinutes: number;
  unestimated: number;
  timeUsedMinutes: number;
  withTimeUsed: number;
  routineTasks: number;
  routineMinutes: number;
};

export type TimeShareTotals = Omit<ProjectTimeShare, "projectId">;

export type TimeShare = {
  totals: TimeShareTotals;
  projects: ProjectTimeShare[];
};

function emptyTotals(): TimeShareTotals {
  return {
    tasks: 0,
    estimatedMinutes: 0,
    unestimated: 0,
    timeUsedMinutes: 0,
    withTimeUsed: 0,
    routineTasks: 0,
    routineMinutes: 0,
  };
}

/** The user-local day a completed row counts on, or null if it has no day. */
export function dayOf(row: CompletedRow, tz: string): string | null {
  if (row.routineId !== null) return dbDateToStr(row.dueDate);
  return row.completedAt ? dateStrInTz(row.completedAt, tz) : null;
}

function add(into: TimeShareTotals, row: CompletedRow) {
  into.tasks++;
  if (row.estimate === null) into.unestimated++;
  else into.estimatedMinutes += row.estimate;
  if (row.timeUsed !== null) {
    into.timeUsedMinutes += row.timeUsed;
    into.withTimeUsed++;
  }
  if (row.routineId !== null) {
    into.routineTasks++;
    into.routineMinutes += row.estimate ?? 0;
  }
}

/**
 * Group the completed rows that fall on a day in `from..to` (inclusive,
 * 'YYYY-MM-DD') by project. Only projects with at least one counted row are
 * returned; the caller joins names and the projects with nothing done.
 */
export function summarizeTimeByProject(
  rows: CompletedRow[],
  from: string,
  to: string,
  tz: string,
): TimeShare {
  const totals = emptyTotals();
  const byProject = new Map<string, ProjectTimeShare>();

  for (const row of rows) {
    const day = dayOf(row, tz);
    if (day === null || day < from || day > to) continue;

    let p = byProject.get(row.projectId);
    if (!p) {
      p = { projectId: row.projectId, ...emptyTotals() };
      byProject.set(row.projectId, p);
    }
    add(p, row);
    add(totals, row);
  }

  const projects = [...byProject.values()].sort(
    (a, b) =>
      b.estimatedMinutes - a.estimatedMinutes ||
      b.tasks - a.tasks ||
      a.projectId.localeCompare(b.projectId),
  );
  return { totals, projects };
}

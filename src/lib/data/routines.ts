import { prisma } from "@/lib/db";
import {
  addDays,
  dateStrInTz,
  dbDateToStr,
  toDbDate,
  todayStr,
} from "@/lib/date";
import {
  isDueOn,
  isRepeatUnit,
  normalizeRepeat,
  occurrencesBetween,
  type RepeatSpec,
} from "@/lib/repeat";

import type {
  RoutineDTO,
  RoutineRepeatBase,
  RoutineRepeatUnit,
  TaskDTO,
} from "@/lib/types";
import { getInboxId, userOwnsProject } from "@/lib/data/projects";
import { TASK_SELECT, taskToDTO } from "@/lib/data/tasks";

/**
 * A routine occurrence is COMPUTED from the cadence, never stored as pending
 * work. A `Task` row with `routineId` set exists only for an outcome:
 *
 *  - 'completed' — written when the user ticks a day (today, ahead of time, or
 *    late from the Activity grid);
 *  - 'missed'    — written by `recordMissedDays` once a due day has passed.
 *
 * There is deliberately no 'active' routine row. Anything that would create
 * one (re-opening a completed day, say) has to delete or mark the row instead,
 * or the board would show the same occurrence twice: once as a stored task and
 * once as its projection.
 */

/**
 * `recordMissedDays` never writes history before this day (docs/ROUTINES.md
 * §RV9).
 *
 * It is a hard floor rather than a rolling window on purpose: a recorded miss
 * is inferred, not observed, and `Routine` stores only whether a routine is
 * active at this moment, with no history of when it was paused. Walking
 * backwards past this date would invent weeks of failure for routines that had
 * been deliberately switched off. Raising it is safe; lowering it fabricates
 * history.
 */
const BACKFILL_EPOCH = "2026-07-18";

/** Also cap the look-back, so returning from a long absence can't write
 * hundreds of rows inside one page load. */
const BACKFILL_MAX_DAYS = 30;

type RoutineRow = {
  id: string;
  content: string;
  description: string | null;
  priority: number;
  estimate: number | null;
  projectId: string;
  repeatEvery: number;
  repeatUnit: string;
  repeatWeekdays: number[];
  repeatBase: string;
  startDate: Date;
  endDate: Date | null;
  active: boolean;
  createdAt: Date;
};

const SELECT = {
  id: true,
  content: true,
  description: true,
  priority: true,
  estimate: true,
  projectId: true,
  repeatEvery: true,
  repeatUnit: true,
  repeatWeekdays: true,
  repeatBase: true,
  startDate: true,
  endDate: true,
  active: true,
  createdAt: true,
} as const;

/** The columns a row needs before it can be copied into an outcome row. */
const OCCURRENCE_SELECT = {
  id: true,
  projectId: true,
  content: true,
  description: true,
  priority: true,
  estimate: true,
  repeatEvery: true,
  repeatUnit: true,
  repeatWeekdays: true,
  repeatBase: true,
  startDate: true,
  endDate: true,
  active: true,
} as const;

type CadenceRow = Pick<
  RoutineRow,
  | "repeatEvery"
  | "repeatUnit"
  | "repeatWeekdays"
  | "repeatBase"
  | "startDate"
  | "endDate"
>;

function baseOf(r: { repeatBase: string }): RoutineRepeatBase {
  return r.repeatBase === "completed" ? "completed" : "scheduled";
}

/**
 * A stored row as the cadence rules read it. `base` overrides the stored one
 * for callers asking "is this date on the calendar grid?", which is a
 * scheduled-based question whatever the routine's own base is.
 */
function toSpec(r: CadenceRow, base: RoutineRepeatBase = baseOf(r)): RepeatSpec {
  return {
    repeatEvery: r.repeatEvery,
    repeatUnit: isRepeatUnit(r.repeatUnit) ? r.repeatUnit : "day",
    repeatWeekdays: r.repeatWeekdays,
    repeatBase: base,
    startDate: dbDateToStr(r.startDate)!,
    endDate: dbDateToStr(r.endDate),
  };
}

function toDTO(r: RoutineRow, lastCompletedOn: string | null): RoutineDTO {
  const spec = toSpec(r);
  return {
    id: r.id,
    content: r.content,
    description: r.description,
    priority: r.priority,
    estimate: r.estimate,
    projectId: r.projectId,
    repeatEvery: spec.repeatEvery,
    repeatUnit: spec.repeatUnit,
    repeatWeekdays: spec.repeatWeekdays,
    repeatBase: spec.repeatBase,
    startDate: spec.startDate,
    endDate: spec.endDate,
    active: r.active,
    lastCompletedOn,
    createdAt: r.createdAt.toISOString(),
  };
}

async function timezoneOf(userId: string): Promise<string> {
  const profile = await prisma.profile.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  return profile?.timezone ?? "UTC";
}

/** routineId → the user-local day of its newest completion. Routines that
 * have never been completed are absent from the map. */
async function lastCompletionDays(
  userId: string,
  routineIds: string[],
  tz: string,
): Promise<Map<string, string>> {
  if (routineIds.length === 0) return new Map();
  const groups = await prisma.task.groupBy({
    by: ["routineId"],
    where: {
      userId,
      routineId: { in: routineIds },
      status: "completed",
      completedAt: { not: null },
    },
    _max: { completedAt: true },
  });
  const days = new Map<string, string>();
  for (const g of groups) {
    if (g.routineId && g._max.completedAt) {
      days.set(g.routineId, dateStrInTz(g._max.completedAt, tz));
    }
  }
  return days;
}

export async function listRoutines(userId: string): Promise<RoutineDTO[]> {
  const rows = await prisma.routine.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: SELECT,
  });
  // Only completed-based cadences measure from the last completion, so only
  // they need it to decide whether today is due.
  const completedBased = rows
    .filter((r) => baseOf(r) === "completed")
    .map((r) => r.id);
  const last = await lastCompletionDays(
    userId,
    completedBased,
    await timezoneOf(userId),
  );
  return rows.map((r) => toDTO(r, last.get(r.id) ?? null));
}

/** One real thing that happened to a routine on one day (docs/ROUTINES.md §RV8). */
export type RoutineDayDTO = {
  routineId: string;
  date: string;
  status: "completed" | "missed";
  /** ISO timestamp; null on a missed day. */
  completedAt: string | null;
  /** Completed on a later local day than the one it was due. */
  madeUp: boolean;
};

/**
 * Every recorded routine outcome in `[from, to]` — the Activity grid's only
 * data source (§RV8). Deliberately NOT `listTasks`: that caps completed rows
 * at 200 and drops 'missed' entirely, both fatal for a history view.
 *
 * Returns only what actually happened. It does NOT say which days were *due* —
 * the client derives that from the cadence with `occurrencesBetween`, the same
 * function `recordMissedDays` uses, so a grid cell and a recorded miss can
 * never disagree about whether a day counted. A due day with no row here is
 * genuinely unknown ("no record"), not a miss, and the grid draws it that way.
 *
 * `madeUp` compares two days in `tz`, so it is a reading, not a stored fact: a
 * completion near midnight reads differently after a timezone change.
 */
export async function listRoutineHistory(
  userId: string,
  from: string,
  to: string,
  tz: string,
): Promise<RoutineDayDTO[]> {
  const rows = await prisma.task.findMany({
    where: {
      userId,
      routineId: { not: null },
      status: { in: ["completed", "missed"] },
      dueDate: { gte: toDbDate(from), lte: toDbDate(to) },
    },
    orderBy: { dueDate: "asc" },
    select: { routineId: true, dueDate: true, status: true, completedAt: true },
  });
  return rows.map((r) => {
    const date = dbDateToStr(r.dueDate)!;
    const done = r.status === "completed";
    return {
      routineId: r.routineId!,
      date,
      status: done ? "completed" : "missed",
      completedAt: done && r.completedAt ? r.completedAt.toISOString() : null,
      madeUp:
        done && r.completedAt !== null && dateStrInTz(r.completedAt, tz) > date,
    };
  });
}

/** 'clear' removes the record entirely — the only honest undo for "I did do
 * that day" when no row existed before it (docs/ROUTINES.md §RV9). */
export type RoutineDayStatus = "completed" | "missed" | "clear";

/**
 * Correct what one past day says about one routine — the Activity grid's
 * click-a-cell path (§RV9). This is the counterweight to the app asserting
 * things it never observed: any miss the engine inferred, the user can
 * overrule. Marking a past day completed is how a day gets made up.
 *
 * Deliberately looser than `completeOccurrence`, which must refuse anything
 * off-cadence:
 *  - paused routines are allowed; pausing shouldn't freeze your history;
 *  - completed-based routines are allowed, but only on days that already have
 *    a row — their cadence isn't computable, so there is nothing else to
 *    validate a bare date against;
 *  - the date must be today or earlier. Asserting a future day was missed is
 *    meaningless, and completing one ahead is `completeOccurrence`'s job.
 *
 * `completedAt` restores an earlier completion time instead of stamping the
 * present. An undo needs it: re-completing an on-time day at the present
 * moment would otherwise turn it into a made-up one.
 */
export async function setRoutineDay(
  userId: string,
  routineId: string,
  date: string,
  status: RoutineDayStatus,
  completedAt?: string,
): Promise<void> {
  const r = await prisma.routine.findFirst({
    where: { id: routineId, userId },
    select: OCCURRENCE_SELECT,
  });
  if (!r) throw new Error("Routine not found");

  if (date > todayStr(await timezoneOf(userId))) {
    throw new Error("Can't correct a future day");
  }

  const existing = await prisma.task.findFirst({
    where: { userId, routineId, dueDate: toDbDate(date) },
    select: { id: true },
  });

  if (status === "clear") {
    // Scoped to routine rows so a crafted id can never remove an ordinary task.
    if (existing) {
      await prisma.task.deleteMany({
        where: { id: existing.id, userId, routineId: { not: null } },
      });
    }
    return;
  }

  let stamp: Date | null = null;
  if (status === "completed") {
    const now = new Date();
    const restored = completedAt ? new Date(completedAt) : now;
    // A completion can't be dated ahead of the moment it is recorded.
    stamp = Number.isNaN(restored.getTime()) || restored > now ? now : restored;
  }

  if (existing) {
    await prisma.task.updateMany({
      where: { id: existing.id, userId },
      data: { status, completedAt: stamp },
    });
    return;
  }

  // No row yet: only mint one on a day the cadence actually covers, so a
  // crafted call can't scatter records across arbitrary dates.
  if (!isDueOn(toSpec(r, "scheduled"), date, null)) {
    throw new Error("Routine isn't due on that date");
  }

  await prisma.task.createMany({
    data: [await outcomeRow(userId, r, date, status, stamp)],
    // A double click races itself; the unique index settles it.
    skipDuplicates: true,
  });
}

/** The template's fields copied onto one dated outcome, appended to the end
 * of its project's list. */
async function outcomeRow(
  userId: string,
  r: {
    id: string;
    projectId: string;
    content: string;
    description: string | null;
    priority: number;
    estimate: number | null;
  },
  date: string,
  status: "completed" | "missed",
  completedAt: Date | null,
) {
  const max = await prisma.task.aggregate({
    where: { userId, projectId: r.projectId },
    _max: { order: true },
  });
  return {
    userId,
    projectId: r.projectId,
    routineId: r.id,
    content: r.content,
    description: r.description,
    priority: r.priority,
    estimate: r.estimate,
    dueDate: toDbDate(date),
    order: (max._max.order ?? 0) + 1,
    status,
    completedAt,
  };
}

export type CreateRoutineInput = {
  content: string;
  description?: string | null;
  priority?: number;
  estimate?: number | null;
  projectId?: string | null;
  repeatEvery?: number;
  repeatUnit?: RoutineRepeatUnit;
  repeatWeekdays?: number[];
  repeatBase?: RoutineRepeatBase;
  endDate?: string | null;
};

export async function createRoutine(
  userId: string,
  input: CreateRoutineInput,
): Promise<RoutineDTO> {
  // Resolve project: verify ownership, else default to Inbox (TDD §6.2/§7).
  let projectId = input.projectId ?? null;
  if (projectId) {
    if (!(await userOwnsProject(userId, projectId))) {
      throw new Error("Project not found");
    }
  } else {
    projectId = await getInboxId(userId);
  }

  // The grid anchor is the user-local creation day (docs/ROUTINES.md §4.1).
  const startDate = todayStr(await timezoneOf(userId));

  const repeat = normalizeRepeat(
    {
      repeatEvery: input.repeatEvery ?? 1,
      repeatUnit: input.repeatUnit ?? "day",
      repeatWeekdays: input.repeatWeekdays ?? [],
      repeatBase: input.repeatBase ?? "scheduled",
    },
    startDate,
  );

  const r = await prisma.routine.create({
    data: {
      userId,
      projectId,
      content: input.content,
      description: input.description ?? null,
      priority: input.priority ?? 4,
      estimate: input.estimate ?? null,
      ...repeat,
      startDate: toDbDate(startDate),
      endDate: input.endDate ? toDbDate(input.endDate) : null,
    },
    select: SELECT,
  });
  return toDTO(r, null);
}

export type UpdateRoutineInput = {
  content?: string;
  description?: string | null;
  priority?: number;
  estimate?: number | null;
  projectId?: string;
  repeatEvery?: number;
  repeatUnit?: RoutineRepeatUnit;
  repeatWeekdays?: number[];
  repeatBase?: RoutineRepeatBase;
  endDate?: string | null;
  active?: boolean;
};

/** Edits the template only — recorded outcomes keep the values they were
 * written with. */
export async function updateRoutine(
  userId: string,
  id: string,
  input: UpdateRoutineInput,
): Promise<RoutineDTO> {
  const existing = await prisma.routine.findFirst({
    where: { id, userId },
    select: {
      repeatEvery: true,
      repeatUnit: true,
      repeatWeekdays: true,
      repeatBase: true,
      startDate: true,
    },
  });
  if (!existing) throw new Error("Routine not found");

  if (input.projectId && !(await userOwnsProject(userId, input.projectId))) {
    throw new Error("Project not found");
  }

  const data: Record<string, unknown> = {};
  if (input.content !== undefined) data.content = input.content;
  if (input.description !== undefined) data.description = input.description;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.estimate !== undefined) data.estimate = input.estimate;
  if (input.projectId !== undefined) data.projectId = input.projectId;
  if (input.endDate !== undefined) {
    data.endDate = input.endDate ? toDbDate(input.endDate) : null;
  }
  if (input.active !== undefined) data.active = input.active;

  // Repeat fields normalize as a set: switching unit alone (say day → weekday)
  // has to re-canonicalize `repeatEvery`/`repeatWeekdays` against what is
  // already stored, so merge the patch over the row before normalizing.
  const touchesRepeat =
    input.repeatEvery !== undefined ||
    input.repeatUnit !== undefined ||
    input.repeatWeekdays !== undefined ||
    input.repeatBase !== undefined;
  if (touchesRepeat) {
    Object.assign(
      data,
      normalizeRepeat(
        {
          repeatEvery: input.repeatEvery ?? existing.repeatEvery,
          repeatUnit:
            input.repeatUnit ??
            (isRepeatUnit(existing.repeatUnit) ? existing.repeatUnit : "day"),
          repeatWeekdays: input.repeatWeekdays ?? existing.repeatWeekdays,
          repeatBase: input.repeatBase ?? baseOf(existing),
        },
        dbDateToStr(existing.startDate)!,
      ),
    );
  }

  // A miss is judged by the schedule in force on the day it happened. Settle
  // the days already past under the stored schedule before this edit replaces
  // it or switches the routine off, or they would be judged by the new one —
  // or, once paused, never recorded at all.
  const reschedules =
    touchesRepeat || input.endDate !== undefined || input.active === false;
  if (reschedules) {
    await recordMissedDays(userId, todayStr(await timezoneOf(userId)));
  }

  const r = await prisma.routine.update({ where: { id }, data, select: SELECT });
  const last =
    baseOf(r) === "completed"
      ? await lastCompletionDays(userId, [r.id], await timezoneOf(userId))
      : new Map<string, string>();
  return toDTO(r, last.get(r.id) ?? null);
}

/**
 * Record that one occurrence was done, on its own date — the tick on a routine
 * card. `date` may be today or, for a calendar cadence, any later due day
 * ("I did Thursday's routine today", docs/ROUTINES.md §RV6).
 *
 * Guarded on every axis the cards already respect, because a server action is
 * reachable with any arguments:
 *  - the routine must be the caller's and active;
 *  - `date` must not be in the past. Completing a past day is a correction,
 *    which belongs to `setRoutineDay`;
 *  - `date` must be a real occurrence, not any day the caller names;
 *  - a completed-based routine can only be completed for today. Its next date
 *    depends on when this one is ticked, so no later occurrence is knowable.
 *
 * Idempotent via the (routineId, dueDate) unique index: a double click leaves
 * one row. A row already recorded as missed for that date is turned into the
 * completion rather than left standing, since the card it belongs to is the
 * one being ticked.
 */
export async function completeOccurrence(
  userId: string,
  routineId: string,
  date: string,
): Promise<TaskDTO> {
  const r = await prisma.routine.findFirst({
    where: { id: routineId, userId },
    select: OCCURRENCE_SELECT,
  });
  if (!r) throw new Error("Routine not found");
  if (!r.active) throw new Error("Routine is paused");

  const tz = await timezoneOf(userId);
  const today = todayStr(tz);
  if (date < today) throw new Error("Can't act on a past occurrence");

  // Answered before the due check on purpose: completing a completed-based
  // routine makes it not due, so a repeated tick would otherwise be refused.
  const done = await prisma.task.findFirst({
    where: {
      userId,
      routineId: r.id,
      dueDate: toDbDate(date),
      status: "completed",
    },
    select: TASK_SELECT,
  });
  if (done) return taskToDTO(done);

  if (baseOf(r) === "completed") {
    if (date !== today) {
      throw new Error(
        "Can't complete a future occurrence of an after-completion routine",
      );
    }
    const last = await lastCompletionDays(userId, [r.id], tz);
    if (!isDueOn(toSpec(r), today, last.get(r.id) ?? null)) {
      throw new Error("Routine isn't due on that date");
    }
  } else if (!isDueOn(toSpec(r), date, null)) {
    throw new Error("Routine isn't due on that date");
  }

  const completedAt = new Date();
  await prisma.task.createMany({
    data: [await outcomeRow(userId, r, date, "completed", completedAt)],
    skipDuplicates: true,
  });
  await prisma.task.updateMany({
    where: {
      userId,
      routineId: r.id,
      dueDate: toDbDate(date),
      status: { not: "completed" },
    },
    data: { status: "completed", completedAt },
  });

  const row = await prisma.task.findFirst({
    where: { userId, routineId: r.id, dueDate: toDbDate(date) },
    select: TASK_SELECT,
  });
  if (!row) throw new Error("Couldn't record that occurrence");
  return taskToDTO(row);
}

/**
 * Delete a routine. Its recorded outcomes survive as history: the foreign key
 * is ON DELETE SET NULL (docs/ROUTINES.md §2).
 */
export async function deleteRoutine(userId: string, id: string): Promise<void> {
  const removed = await prisma.routine.deleteMany({ where: { id, userId } });
  if (removed.count === 0) throw new Error("Routine not found");
}

/**
 * Write a 'missed' row for every due day that has passed with no outcome, so
 * the Activity grid isn't full of holes and stats don't under-report.
 * Idempotent and user-scoped; `today` is the user-local day.
 *
 * It INFERS a miss it never observed, which is why it is bounded hard at both
 * ends:
 *  - never before BACKFILL_EPOCH, so it cannot rewrite the past;
 *  - never more than BACKFILL_MAX_DAYS back, so one long absence cannot dump
 *    hundreds of rows into a single request.
 * Every row it writes is correctable by the user through `setRoutineDay`,
 * which is what makes inferring acceptable at all.
 *
 * Two kinds of routine are skipped:
 *  - paused ones, since a day the routine was switched off is not a miss;
 *  - completed-based ones, whose cadence measures from the last completion
 *    and so has no grid of due days to find gaps in.
 *
 * Concurrent invocations are absorbed by the (routineId, dueDate) unique index
 * and `skipDuplicates` — no locking.
 */
export async function recordMissedDays(
  userId: string,
  today: string,
): Promise<void> {
  const earliest = addDays(today, -BACKFILL_MAX_DAYS);
  const from = BACKFILL_EPOCH > earliest ? BACKFILL_EPOCH : earliest;
  const yesterday = addDays(today, -1);
  if (from > yesterday) return;

  const routines = await prisma.routine.findMany({
    where: { userId, active: true, repeatBase: { not: "completed" } },
    select: OCCURRENCE_SELECT,
  });
  if (routines.length === 0) return;

  const known = await prisma.task.findMany({
    where: {
      userId,
      routineId: { in: routines.map((r) => r.id) },
      dueDate: { gte: toDbDate(from), lte: toDbDate(yesterday) },
    },
    select: { routineId: true, dueDate: true },
  });
  const have = new Set(
    known.map((k) => `${k.routineId}|${dbDateToStr(k.dueDate)}`),
  );

  const gaps = routines.flatMap((routine) =>
    occurrencesBetween(toSpec(routine, "scheduled"), from, yesterday)
      .filter((date) => !have.has(`${routine.id}|${date}`))
      .map((date) => ({ routine, date })),
  );
  if (gaps.length === 0) return;

  await prisma.task.createMany({
    data: gaps.map(({ routine, date }) => ({
      userId,
      projectId: routine.projectId,
      routineId: routine.id,
      content: routine.content,
      description: routine.description,
      priority: routine.priority,
      estimate: routine.estimate,
      dueDate: toDbDate(date),
      status: "missed",
      // 'missed' rows never appear in an ordered list.
      order: 0,
    })),
    skipDuplicates: true,
  });
}

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
} from "@/lib/repeat";

import type {
  RoutineDTO,
  RoutineRepeatBase,
  RoutineRepeatUnit,
} from "@/lib/types";
import { getInboxId, userOwnsProject } from "@/lib/data/projects";

/**
 * Backfill never writes history before this day (docs/ROUTINES.md §RV9).
 *
 * It is the day the feature shipped, and it is a hard floor rather than a
 * rolling window on purpose: backfill records misses it never observed, and
 * `Routine` stores only whether a routine is active *now*, with no history of
 * when it was paused. Walking backwards past this date would invent weeks of
 * failure for routines that had been deliberately switched off. Raising it is
 * safe; lowering it fabricates history.
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

function toDTO(r: RoutineRow): RoutineDTO {
  return {
    id: r.id,
    content: r.content,
    description: r.description,
    priority: r.priority,
    estimate: r.estimate,
    projectId: r.projectId,
    repeatEvery: r.repeatEvery,
    repeatUnit: isRepeatUnit(r.repeatUnit) ? r.repeatUnit : "day",
    repeatWeekdays: r.repeatWeekdays,
    repeatBase: r.repeatBase === "completed" ? "completed" : "scheduled",
    startDate: dbDateToStr(r.startDate)!,
    endDate: dbDateToStr(r.endDate),
    active: r.active,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listRoutines(userId: string): Promise<RoutineDTO[]> {
  const rows = await prisma.routine.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: SELECT,
  });
  return rows.map(toDTO);
}

/** One real thing that happened to a routine on one day (docs/ROUTINES.md §RV8). */
export type RoutineDayDTO = {
  routineId: string;
  date: string;
  status: "completed" | "missed";
};

/**
 * Every recorded routine instance in `[from, to]` — the Activity grid's only
 * data source (§RV8). Deliberately NOT `listTasks`: that caps completed rows
 * at 200 and drops 'missed' entirely, both fatal for a history view.
 *
 * Returns only what actually happened. It does NOT say which days were *due* —
 * the client derives that from the cadence with `occurrencesBetween`, the same
 * function the spawner uses (§RV5), so a grid cell and a real instance can
 * never disagree about whether a day counted. A due day with no row here is
 * genuinely unknown ("no record"), not a miss, and the grid draws it that way.
 */
export async function listRoutineHistory(
  userId: string,
  from: string,
  to: string,
): Promise<RoutineDayDTO[]> {
  const rows = await prisma.task.findMany({
    where: {
      userId,
      routineId: { not: null },
      status: { in: ["completed", "missed"] },
      dueDate: { gte: toDbDate(from), lte: toDbDate(to) },
    },
    orderBy: { dueDate: "asc" },
    select: { routineId: true, dueDate: true, status: true },
  });
  return rows.map((r) => ({
    routineId: r.routineId!,
    date: dbDateToStr(r.dueDate)!,
    status: r.status === "completed" ? "completed" : "missed",
  }));
}

/** 'clear' removes the record entirely — the only honest undo for "I did do
 * that day" when no row existed before it (docs/ROUTINES.md §RV9). */
export type RoutineDayStatus = "completed" | "missed" | "clear";

/**
 * Correct what one past day says about one routine — the Activity grid's
 * click-a-cell path (§RV9). This is the counterweight to the app asserting
 * things it never observed: any day the engine guessed at, the user can
 * overrule.
 *
 * Deliberately looser than `completeOccurrence` (§RV6), which creates FUTURE
 * work and so must refuse anything off-cadence:
 *  - paused routines are allowed; pausing shouldn't freeze your history;
 *  - completed-based routines are allowed, but only on days that already have
 *    a row — their cadence isn't computable, so there is nothing else to
 *    validate a bare date against;
 *  - the date must be today or earlier. Asserting a future day was missed is
 *    meaningless, and completing one ahead is RV6's job.
 */
export async function setRoutineDay(
  userId: string,
  routineId: string,
  date: string,
  status: RoutineDayStatus,
): Promise<void> {
  const r = await prisma.routine.findFirst({
    where: { id: routineId, userId },
    select: {
      id: true,
      projectId: true,
      content: true,
      description: true,
      priority: true,
      repeatEvery: true,
      repeatUnit: true,
      repeatWeekdays: true,
      repeatBase: true,
      startDate: true,
      endDate: true,
    },
  });
  if (!r) throw new Error("Routine not found");

  const profile = await prisma.profile.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  if (date > todayStr(profile?.timezone ?? "UTC")) {
    throw new Error("Can't correct a future day");
  }

  const existing = await prisma.task.findFirst({
    where: { userId, routineId, dueDate: toDbDate(date) },
    select: { id: true },
  });

  if (status === "clear") {
    // Only ever removes a routine instance, never an ordinary task, and only
    // one that already carries a verdict — an active instance is live work.
    if (existing) {
      await prisma.task.deleteMany({
        where: {
          id: existing.id,
          userId,
          routineId: { not: null },
          status: { in: ["completed", "missed"] },
        },
      });
    }
    return;
  }

  if (existing) {
    await prisma.task.updateMany({
      where: { id: existing.id, userId },
      data: {
        status,
        completedAt: status === "completed" ? new Date() : null,
      },
    });
    return;
  }

  // No row yet: only mint one on a day the cadence actually covers, so a
  // crafted call can't scatter records across arbitrary dates.
  const due = isDueOn(
    {
      repeatEvery: r.repeatEvery,
      repeatUnit: isRepeatUnit(r.repeatUnit) ? r.repeatUnit : "day",
      repeatWeekdays: r.repeatWeekdays,
      repeatBase: "scheduled",
      startDate: dbDateToStr(r.startDate)!,
      endDate: dbDateToStr(r.endDate),
    },
    date,
    null,
  );
  if (!due) throw new Error("Routine isn't due on that date");

  const max = await prisma.task.aggregate({
    where: { userId, projectId: r.projectId },
    _max: { order: true },
  });
  await prisma.task.createMany({
    data: [
      {
        userId,
        projectId: r.projectId,
        routineId: r.id,
        content: r.content,
        description: r.description,
        priority: r.priority,
        dueDate: toDbDate(date),
        order: (max._max.order ?? 0) + 1,
        status,
        completedAt: status === "completed" ? new Date() : null,
      },
    ],
    // A double click races itself; the unique index settles it.
    skipDuplicates: true,
  });
}

export type CreateRoutineInput = {
  content: string;
  description?: string | null;
  priority?: number;
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
  const profile = await prisma.profile.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const startDate = todayStr(profile?.timezone ?? "UTC");

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
      ...repeat,
      startDate: toDbDate(startDate),
      endDate: input.endDate ? toDbDate(input.endDate) : null,
    },
    select: SELECT,
  });
  return toDTO(r);
}

export type UpdateRoutineInput = {
  content?: string;
  description?: string | null;
  priority?: number;
  projectId?: string;
  repeatEvery?: number;
  repeatUnit?: RoutineRepeatUnit;
  repeatWeekdays?: number[];
  repeatBase?: RoutineRepeatBase;
  endDate?: string | null;
  active?: boolean;
};

/** Edits the template only — already-spawned instances keep their values. */
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
          repeatBase:
            input.repeatBase ??
            (existing.repeatBase === "completed" ? "completed" : "scheduled"),
        },
        dbDateToStr(existing.startDate)!,
      ),
    );
  }

  const r = await prisma.routine.update({ where: { id }, data, select: SELECT });
  return toDTO(r);
}

/**
 * Materialize one future occurrence, already completed — the "I did Thursday's
 * routine today" path behind the Upcoming board's ghost cards
 * (docs/ROUTINES.md §RV6). DR2's today-only spawn is untouched: nothing is
 * pre-spawned, the row exists because the user acted on it.
 *
 * Guarded on every axis the ghost cards already respect, because a server
 * action is reachable with any arguments:
 *  - the routine must be the caller's and active;
 *  - completed-based routines are rejected outright — their next date depends
 *    on when the current one is ticked, so no future occurrence is knowable
 *    (which is why `occurrencesBetween` projects none);
 *  - `date` must be a real occurrence on the cadence, not any day the caller
 *    names;
 *  - `date` must not be in the past. Ghosts only ever offer today-or-later,
 *    and backdating a completion would fabricate the per-day history DR1
 *    exists to keep honest.
 *
 * Idempotent via the (routineId, dueDate) unique + `skipDuplicates`: a double
 * click, or the day's own materialization racing this, still leaves one row.
 * An existing row is deliberately never overwritten — if today's instance is
 * already there and active, this must not silently complete it.
 */
export async function completeOccurrence(
  userId: string,
  routineId: string,
  date: string,
): Promise<void> {
  const r = await prisma.routine.findFirst({
    where: { id: routineId, userId },
    select: {
      id: true,
      projectId: true,
      content: true,
      description: true,
      priority: true,
      repeatEvery: true,
      repeatUnit: true,
      repeatWeekdays: true,
      repeatBase: true,
      startDate: true,
      endDate: true,
      active: true,
    },
  });
  if (!r) throw new Error("Routine not found");
  if (!r.active) throw new Error("Routine is paused");
  if (r.repeatBase === "completed") {
    throw new Error("Can't complete a future occurrence of an after-completion routine");
  }

  const profile = await prisma.profile.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const today = todayStr(profile?.timezone ?? "UTC");
  if (date < today) throw new Error("Can't complete a past occurrence");

  const due = isDueOn(
    {
      repeatEvery: r.repeatEvery,
      repeatUnit: isRepeatUnit(r.repeatUnit) ? r.repeatUnit : "day",
      repeatWeekdays: r.repeatWeekdays,
      repeatBase: "scheduled",
      startDate: dbDateToStr(r.startDate)!,
      endDate: dbDateToStr(r.endDate),
    },
    date,
    null,
  );
  if (!due) throw new Error("Routine isn't due on that date");

  const max = await prisma.task.aggregate({
    where: { userId, projectId: r.projectId },
    _max: { order: true },
  });

  await prisma.task.createMany({
    data: [
      {
        userId,
        projectId: r.projectId,
        routineId: r.id,
        content: r.content,
        description: r.description,
        priority: r.priority,
        dueDate: toDbDate(date),
        order: (max._max.order ?? 0) + 1,
        status: "completed",
        completedAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });
}

/**
 * Delete a routine. Completed/missed instances survive as history (the FK is
 * ON DELETE SET NULL); still-active instances are deleted with the template
 * (docs/ROUTINES.md §2).
 */
export async function deleteRoutine(userId: string, id: string): Promise<void> {
  const existing = await prisma.routine.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) throw new Error("Routine not found");

  await prisma.$transaction([
    prisma.task.deleteMany({ where: { userId, routineId: id, status: "active" } }),
    prisma.routine.delete({ where: { id } }),
  ]);
}

/**
 * The recurrence engine (docs/ROUTINES.md §3.2, §4.1) — the only place that
 * knows routines recur. Idempotent and user-scoped; called from the tasks
 * read path with `today = todayStr(profile.timezone)` and the profile tz
 * (needed to turn `completedAt` timestamps into local calendar days).
 * Retire → backfill → spawn:
 *
 *  1. retire: an unfinished instance whose day has passed is set to 'missed'
 *             with its dueDate FROZEN on its own day — that frozen date is the
 *             per-day history DR1 exists to keep, and the old carry rule
 *             destroyed it by overwriting the date (§RV7). The work is not
 *             lost: each active routine also gets one ordinary CATCH-UP task
 *             (routineId NULL, fromRoutineId set), dated the missed day, which
 *             the user can reschedule freely because it carries no routineId
 *             and so no date lock (§RV1). At most one outstanding catch-up per
 *             routine, so a week of ignored days is 7 records but 1 task.
 *             Paused routines are recorded but mint nothing.
 *  2. backfill: due days with no row at all — the app was never opened on
 *             them — get a 'missed' record, so the Activity grid isn't full of
 *             holes and stats don't under-report. Bounded at both ends
 *             (BACKFILL_EPOCH, BACKFILL_MAX_DAYS) because it infers rather
 *             than observes; every row is user-correctable (§RV9).
 *  3. spawn:  one instance per active routine that is DUE today and lacks an
 *             instance dated today or later (any status). Due today means:
 *             - scheduled-based: today is on the startDate + k·repeatEvery
 *               grid (late completion never shifts the grid);
 *             - completed-based: at least repeatEvery days have passed since
 *               the local day of the last completion (first occurrence on
 *               startDate);
 *             and today is not past endDate (inclusive).
 *
 * Concurrent invocations are absorbed by the (routineId, dueDate) unique
 * index + `skipDuplicates` — no locking.
 */
export async function materializeRoutines(
  userId: string,
  today: string,
  tz: string,
): Promise<void> {
  const todayDb = toDbDate(today);

  // 1. Retire every stale instance, and mint catch-up work for the active ones.
  const stale = await prisma.task.findMany({
    where: {
      userId,
      status: "active",
      dueDate: { lt: todayDb },
      routineId: { not: null },
    },
    // Oldest first: when several days of one routine are retired at once, the
    // catch-up inherits the OLDEST missed date, so its overdue age tells the
    // truth about how long the work has been owed.
    orderBy: { dueDate: "asc" },
    select: {
      id: true,
      routineId: true,
      projectId: true,
      content: true,
      description: true,
      priority: true,
      dueDate: true,
      routine: { select: { active: true } },
    },
  });
  if (stale.length > 0) {
    const staleRoutineIds = [...new Set(stale.map((t) => t.routineId!))];

    // The one-outstanding-catch-up guard: a routine that already owes the user
    // an unfinished catch-up does not get another. Seven ignored days leave
    // seven 'missed' records but one task (§RV7).
    const outstanding = await prisma.task.findMany({
      where: {
        userId,
        status: "active",
        fromRoutineId: { in: staleRoutineIds },
      },
      select: { fromRoutineId: true },
    });
    const owed = new Set(outstanding.map((t) => t.fromRoutineId));

    type CatchUp = {
      projectId: string;
      content: string;
      description: string | null;
      priority: number;
      dueDate: Date | null;
      fromRoutineId: string;
    };
    const catchUps: CatchUp[] = [];
    for (const t of stale) {
      // A paused routine's leftover is recorded but never minted into work —
      // you paused it on purpose, so it must not follow you around.
      if (!t.routine?.active || owed.has(t.routineId)) continue;
      owed.add(t.routineId);
      catchUps.push({
        // Copied from the INSTANCE, not the template: any edit the user made to
        // the instance is what they actually saw, and the template may have
        // moved on since.
        projectId: t.projectId,
        content: t.content,
        description: t.description,
        priority: t.priority,
        // Dated the missed day, so it is born overdue rather than mixing into
        // today's list beside today's fresh instance.
        dueDate: t.dueDate,
        fromRoutineId: t.routineId!,
      });
    }

    // Record first, then mint. If the second write fails, the worst case is a
    // recorded miss with no catch-up — a gap in work, not a lie in the history.
    // The reverse order could double-mint on retry.
    await prisma.task.updateMany({
      where: { id: { in: stale.map((t) => t.id) }, userId },
      data: { status: "missed" },
    });

    if (catchUps.length > 0) {
      const maxes = await prisma.task.groupBy({
        by: ["projectId"],
        where: {
          userId,
          projectId: { in: [...new Set(catchUps.map((c) => c.projectId))] },
        },
        _max: { order: true },
      });
      const nextOrder = new Map(
        maxes.map((m) => [m.projectId, m._max.order ?? 0]),
      );
      await prisma.task.createMany({
        data: catchUps.map((c) => {
          const order = (nextOrder.get(c.projectId) ?? 0) + 1;
          nextOrder.set(c.projectId, order);
          // routineId stays NULL — that is what frees the row from RV1's date
          // lock and makes it an ordinary, reschedulable task.
          return { userId, ...c, order };
        }),
      });
    }
  }

  const routines = await prisma.routine.findMany({
    where: { userId, active: true },
    select: {
      id: true,
      projectId: true,
      content: true,
      description: true,
      priority: true,
      repeatEvery: true,
      repeatUnit: true,
      repeatWeekdays: true,
      repeatBase: true,
      startDate: true,
      endDate: true,
    },
  });
  if (routines.length === 0) return;

  // 2. Backfill: days the cadence covered that have NO row at all, because
  // materialization only runs when the app is opened (DR2). Without this the
  // Activity grid is full of 'no record' holes (§RV8) and any stat computed
  // from it under-reports. Records only — RV7's retire already minted the one
  // catch-up task, and a fortnight's absence must not produce a fortnight of
  // tasks.
  //
  // Backfill INFERS a miss it never observed, which is why it is bounded hard
  // at both ends:
  //  - never before BACKFILL_EPOCH, so it cannot rewrite the past. We keep no
  //    pause history, so walking backwards would fabricate weeks of failure
  //    for routines that were deliberately switched off (§RV9).
  //  - never more than BACKFILL_MAX_DAYS back, so one long absence cannot dump
  //    hundreds of rows into a single request.
  // Every row it writes is correctable by the user (§RV9 phase A), which is
  // what makes inferring acceptable at all.
  const backfillFrom =
    BACKFILL_EPOCH > addDays(today, -BACKFILL_MAX_DAYS)
      ? BACKFILL_EPOCH
      : addDays(today, -BACKFILL_MAX_DAYS);
  const yesterday = addDays(today, -1);
  // Completed-based routines are excluded: their cadence measures from the
  // last completion, so there is no grid of due days to find gaps in.
  const scheduled = routines.filter((r) => r.repeatBase !== "completed");

  if (backfillFrom <= yesterday && scheduled.length > 0) {
    const known = await prisma.task.findMany({
      where: {
        userId,
        routineId: { in: scheduled.map((r) => r.id) },
        dueDate: { gte: toDbDate(backfillFrom), lte: toDbDate(yesterday) },
      },
      select: { routineId: true, dueDate: true },
    });
    const have = new Set(
      known.map((k) => `${k.routineId}|${dbDateToStr(k.dueDate)}`),
    );

    const gaps: { routine: (typeof scheduled)[number]; date: string }[] = [];
    for (const r of scheduled) {
      const days = occurrencesBetween(
        {
          repeatEvery: r.repeatEvery,
          repeatUnit: isRepeatUnit(r.repeatUnit) ? r.repeatUnit : "day",
          repeatWeekdays: r.repeatWeekdays,
          repeatBase: "scheduled",
          startDate: dbDateToStr(r.startDate)!,
          endDate: dbDateToStr(r.endDate),
        },
        backfillFrom,
        yesterday,
      );
      for (const d of days) {
        if (!have.has(`${r.id}|${d}`)) gaps.push({ routine: r, date: d });
      }
    }

    if (gaps.length > 0) {
      await prisma.task.createMany({
        data: gaps.map(({ routine, date }) => ({
          userId,
          projectId: routine.projectId,
          routineId: routine.id,
          content: routine.content,
          description: routine.description,
          priority: routine.priority,
          dueDate: toDbDate(date),
          status: "missed",
          // 'missed' rows never appear in an ordered list, so they skip the
          // per-project order lookup the spawn step needs.
          order: 0,
        })),
        skipDuplicates: true,
      });
    }
  }

  // 3. Spawn instances for active, due-today routines that don't have one
  // dated today OR LATER, in any status. A completed today-instance must not
  // respawn, and nor must one completed ahead of time (§RV6). The gte check
  // also keeps this safe for future-dated instances (e.g. after a westward
  // timezone change). Retired and backfilled rows above are all dated BEFORE
  // today, so they never suppress today's spawn — that is what gives the user
  // a fresh task today alongside the overdue catch-up (§RV7).
  const existing = await prisma.task.findMany({
    where: {
      userId,
      dueDate: { gte: todayDb },
      routineId: { in: routines.map((r) => r.id) },
    },
    select: { routineId: true },
  });
  const have = new Set(existing.map((e) => e.routineId));
  const candidates = routines.filter((r) => !have.has(r.id));
  if (candidates.length === 0) return;

  // Completed-based routines measure from the local day of the newest
  // completion; scheduled-based ones from their fixed startDate grid.
  const completedBasedIds = candidates
    .filter((r) => r.repeatBase === "completed")
    .map((r) => r.id);
  const lastCompletions =
    completedBasedIds.length > 0
      ? await prisma.task.groupBy({
          by: ["routineId"],
          where: {
            userId,
            routineId: { in: completedBasedIds },
            status: "completed",
            completedAt: { not: null },
          },
          _max: { completedAt: true },
        })
      : [];
  const lastCompletionDay = new Map(
    lastCompletions
      .filter((g) => g._max.completedAt !== null)
      .map((g) => [g.routineId, dateStrInTz(g._max.completedAt!, tz)]),
  );

  const need = candidates.filter((r) =>
    isDueOn(
      {
        repeatEvery: r.repeatEvery,
        repeatUnit: isRepeatUnit(r.repeatUnit) ? r.repeatUnit : "day",
        repeatWeekdays: r.repeatWeekdays,
        repeatBase: r.repeatBase === "completed" ? "completed" : "scheduled",
        startDate: dbDateToStr(r.startDate)!,
        endDate: dbDateToStr(r.endDate),
      },
      today,
      lastCompletionDay.get(r.id) ?? null,
    ),
  );
  if (need.length === 0) return;

  // Append relative to each target project's list (TDD §5).
  const maxes = await prisma.task.groupBy({
    by: ["projectId"],
    where: {
      userId,
      projectId: { in: [...new Set(need.map((r) => r.projectId))] },
    },
    _max: { order: true },
  });
  const nextOrder = new Map(maxes.map((m) => [m.projectId, m._max.order ?? 0]));

  await prisma.task.createMany({
    data: need.map((r) => {
      const order = (nextOrder.get(r.projectId) ?? 0) + 1;
      nextOrder.set(r.projectId, order);
      return {
        userId,
        projectId: r.projectId,
        routineId: r.id,
        content: r.content,
        description: r.description,
        priority: r.priority,
        dueDate: todayDb,
        order,
      };
    }),
    skipDuplicates: true,
  });
}

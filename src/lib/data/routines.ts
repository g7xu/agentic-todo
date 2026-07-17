import { prisma } from "@/lib/db";
import { dateStrInTz, dbDateToStr, toDbDate, todayStr } from "@/lib/date";
import { isDueOn, isRepeatUnit, normalizeRepeat } from "@/lib/repeat";
import type {
  RoutineDTO,
  RoutineRepeatBase,
  RoutineRepeatUnit,
} from "@/lib/types";
import { getInboxId, userOwnsProject } from "@/lib/data/projects";

type RoutineRow = {
  id: string;
  content: string;
  description: string | null;
  priority: number;
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
 * Carry → spawn:
 *
 *  1. carry:  an unfinished instance from a past day rolls forward to today,
 *             whatever the cadence (a routine never piles up and never
 *             silently disappears). Paused routines' leftovers are parked as
 *             'missed' instead of following the user around; so are the rare
 *             collision cases (today's slot already taken), keeping the
 *             (routineId, dueDate) unique satisfiable.
 *  2. spawn:  one instance per active routine that is DUE today and lacks an
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

  // 1. Carry: newest stale instance per active routine moves to today.
  // Extras, collisions with an existing today-or-later instance, and
  // leftovers of paused routines are parked as 'missed'.
  const stale = await prisma.task.findMany({
    where: {
      userId,
      status: "active",
      dueDate: { lt: todayDb },
      routineId: { not: null },
    },
    orderBy: { dueDate: "desc" },
    select: { id: true, routineId: true, routine: { select: { active: true } } },
  });
  if (stale.length > 0) {
    const staleRoutineIds = [...new Set(stale.map((t) => t.routineId!))];
    const todayRows = await prisma.task.findMany({
      where: {
        userId,
        routineId: { in: staleRoutineIds },
        dueDate: { gte: todayDb },
      },
      select: { routineId: true },
    });
    const taken = new Set(todayRows.map((r) => r.routineId));
    const carryIds: string[] = [];
    const parkIds: string[] = [];
    for (const t of stale) {
      if (!t.routine?.active || taken.has(t.routineId)) {
        parkIds.push(t.id);
      } else {
        taken.add(t.routineId);
        carryIds.push(t.id);
      }
    }
    if (carryIds.length > 0) {
      await prisma.task.updateMany({
        where: { id: { in: carryIds }, userId },
        data: { dueDate: todayDb },
      });
    }
    if (parkIds.length > 0) {
      await prisma.task.updateMany({
        where: { id: { in: parkIds }, userId },
        data: { status: "missed" },
      });
    }
  }

  // 2. Spawn instances for active, due-today routines that don't have one
  // dated today OR LATER, in any status. A completed today-instance must not
  // respawn, and the carried instance above already IS today's — the gte
  // check keeps this safe even for future-dated instances (e.g. after a
  // westward timezone change).
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

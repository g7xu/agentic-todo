import { prisma } from "@/lib/db";
import { toDbDate } from "@/lib/date";
import type { RoutineDTO, RoutineOnMiss } from "@/lib/types";
import { getInboxId, userOwnsProject } from "@/lib/data/projects";

type RoutineRow = {
  id: string;
  content: string;
  description: string | null;
  priority: number;
  projectId: string;
  schedule: string;
  onMiss: string;
  active: boolean;
  createdAt: Date;
};

const SELECT = {
  id: true,
  content: true,
  description: true,
  priority: true,
  projectId: true,
  schedule: true,
  onMiss: true,
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
    schedule: r.schedule,
    onMiss: r.onMiss === "carry" ? "carry" : "skip",
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
  onMiss?: RoutineOnMiss;
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

  const r = await prisma.routine.create({
    data: {
      userId,
      projectId,
      content: input.content,
      description: input.description ?? null,
      priority: input.priority ?? 4,
      onMiss: input.onMiss ?? "skip",
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
  onMiss?: RoutineOnMiss;
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
    select: { id: true },
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
  if (input.onMiss !== undefined) data.onMiss = input.onMiss;
  if (input.active !== undefined) data.active = input.active;

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
 * The recurrence engine (docs/ROUTINES.md §3.2) — the only place that knows
 * routines recur. Idempotent and user-scoped; called from the tasks read path
 * with `today = todayStr(profile.timezone)`. Sweep → carry → spawn:
 *
 *  1. sweep:  stale active instances of skip-mode routines → 'missed'
 *  2. carry:  stale active instances of carry-mode routines are rescheduled to
 *             today (or swept if today's slot is already taken)
 *  3. spawn:  one instance per active routine lacking one dated today
 *
 * Concurrent invocations are absorbed by the (routineId, dueDate) unique
 * index + `skipDuplicates` — no locking.
 */
export async function materializeRoutines(
  userId: string,
  today: string,
): Promise<void> {
  const todayDb = toDbDate(today);

  // 1. Sweep. Intentionally not filtered on routine.active: a paused routine's
  // leftover instance should still be swept, not linger as overdue.
  await prisma.task.updateMany({
    where: {
      userId,
      status: "active",
      dueDate: { lt: todayDb },
      routine: { is: { onMiss: "skip" } },
    },
    data: { status: "missed" },
  });

  // 2. Carry: newest stale instance per routine moves to today; extras (or a
  // stale one whose routine already has a today-or-later instance) are swept
  // instead, so the (routineId, dueDate) unique can't collide.
  const stale = await prisma.task.findMany({
    where: {
      userId,
      status: "active",
      dueDate: { lt: todayDb },
      routine: { is: { onMiss: "carry" } },
    },
    orderBy: { dueDate: "desc" },
    select: { id: true, routineId: true },
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
    const sweepIds: string[] = [];
    for (const t of stale) {
      if (taken.has(t.routineId)) {
        sweepIds.push(t.id);
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
    if (sweepIds.length > 0) {
      await prisma.task.updateMany({
        where: { id: { in: sweepIds }, userId },
        data: { status: "missed" },
      });
    }
  }

  // 3. Spawn instances for active routines that don't have one dated today
  // OR LATER, in any status. A completed/missed today-instance must not
  // respawn, and an instance the user rescheduled to a future day counts as
  // a postponement — regenerating today's would duplicate the task
  // (docs/ROUTINES.md §2).
  const routines = await prisma.routine.findMany({
    where: { userId, active: true },
    select: {
      id: true,
      projectId: true,
      content: true,
      description: true,
      priority: true,
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
  const need = routines.filter((r) => !have.has(r.id));
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

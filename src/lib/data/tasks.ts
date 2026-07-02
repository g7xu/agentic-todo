import { prisma } from "@/lib/db";
import { dbDateToStr, toDbDate } from "@/lib/date";
import type { TaskDTO } from "@/lib/types";
import { getInboxId, userOwnsProject } from "@/lib/data/projects";

type TaskRow = {
  id: string;
  content: string;
  description: string | null;
  priority: number;
  dueDate: Date | null;
  status: string;
  order: number;
  projectId: string;
  completedAt: Date | null;
  createdAt: Date;
};

const SELECT = {
  id: true,
  content: true,
  description: true,
  priority: true,
  dueDate: true,
  status: true,
  order: true,
  projectId: true,
  completedAt: true,
  createdAt: true,
} as const;

function toDTO(t: TaskRow): TaskDTO {
  return {
    id: t.id,
    content: t.content,
    description: t.description,
    priority: t.priority,
    dueDate: dbDateToStr(t.dueDate),
    status: t.status === "completed" ? "completed" : "active",
    order: t.order,
    projectId: t.projectId,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
  };
}

/**
 * All active tasks plus recently-completed tasks (for the Completed view and
 * the per-view "show completed" toggle). Scoped to the user.
 */
export async function listTasks(userId: string): Promise<TaskDTO[]> {
  const [active, completed] = await Promise.all([
    prisma.task.findMany({
      where: { userId, status: "active" },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: SELECT,
    }),
    prisma.task.findMany({
      where: { userId, status: "completed" },
      orderBy: { completedAt: "desc" },
      take: 200,
      select: SELECT,
    }),
  ]);
  return [...active, ...completed].map(toDTO);
}

export type CreateTaskInput = {
  content: string;
  description?: string | null;
  priority?: number;
  dueDate?: string | null;
  projectId?: string | null;
};

export async function createTask(
  userId: string,
  input: CreateTaskInput,
): Promise<TaskDTO> {
  // Resolve project: verify ownership, else default to Inbox (TDD §6.2/§7).
  let projectId = input.projectId ?? null;
  if (projectId) {
    if (!(await userOwnsProject(userId, projectId))) {
      throw new Error("Project not found");
    }
  } else {
    projectId = await getInboxId(userId);
  }

  // Append relative to the task's project list (TDD §5).
  const max = await prisma.task.aggregate({
    where: { userId, projectId },
    _max: { order: true },
  });
  const order = (max._max.order ?? 0) + 1;

  const t = await prisma.task.create({
    data: {
      userId,
      projectId,
      content: input.content,
      description: input.description ?? null,
      priority: input.priority ?? 4,
      dueDate: input.dueDate ? toDbDate(input.dueDate) : null,
      order,
    },
    select: SELECT,
  });
  return toDTO(t);
}

/** Create many tasks at once (Plan mode) — all into the user's Inbox, atomically. */
export async function bulkCreateTasks(
  userId: string,
  items: { content: string; priority?: number; description?: string | null }[],
): Promise<{ created: number }> {
  const inboxId = await getInboxId(userId);
  const max = await prisma.task.aggregate({
    where: { userId, projectId: inboxId },
    _max: { order: true },
  });
  let order = max._max.order ?? 0;
  const data = items.map((it) => ({
    userId,
    projectId: inboxId,
    content: it.content,
    priority: it.priority ?? 4,
    description: it.description ?? null,
    order: ++order,
  }));
  const r = await prisma.task.createMany({ data });
  return { created: r.count };
}

export type UpdateTaskInput = {
  content?: string;
  description?: string | null;
  priority?: number;
  dueDate?: string | null;
  projectId?: string;
  order?: number;
};

export async function updateTask(
  userId: string,
  id: string,
  input: UpdateTaskInput,
): Promise<TaskDTO> {
  const existing = await prisma.task.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) throw new Error("Task not found");

  if (input.projectId && !(await userOwnsProject(userId, input.projectId))) {
    throw new Error("Project not found");
  }

  const data: Record<string, unknown> = {};
  if (input.content !== undefined) data.content = input.content;
  if (input.description !== undefined) data.description = input.description;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.projectId !== undefined) data.projectId = input.projectId;
  if (input.order !== undefined) data.order = input.order;
  if (input.dueDate !== undefined) {
    data.dueDate = input.dueDate ? toDbDate(input.dueDate) : null;
  }

  const t = await prisma.task.update({ where: { id }, data, select: SELECT });
  return toDTO(t);
}

export async function setTaskStatus(
  userId: string,
  id: string,
  status: "active" | "completed",
): Promise<TaskDTO> {
  const existing = await prisma.task.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) throw new Error("Task not found");

  const t = await prisma.task.update({
    where: { id },
    data: {
      status,
      completedAt: status === "completed" ? new Date() : null,
    },
    select: SELECT,
  });
  return toDTO(t);
}

/** Returns true if a row was actually deleted (false if no match). */
export async function deleteTask(
  userId: string,
  id: string,
): Promise<boolean> {
  const r = await prisma.task.deleteMany({ where: { id, userId } });
  return r.count > 0;
}

export type BulkResult = {
  applied: string[];
  skipped: { id: string; reason: string }[];
  tasksChanged: boolean;
};

async function partitionOwned(
  userId: string,
  ids: string[],
): Promise<{ owned: string[]; skipped: { id: string; reason: string }[] }> {
  const rows = await prisma.task.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true },
  });
  const ownedSet = new Set(rows.map((r) => r.id));
  return {
    owned: ids.filter((id) => ownedSet.has(id)),
    skipped: ids
      .filter((id) => !ownedSet.has(id))
      .map((id) => ({ id, reason: "not_found" })),
  };
}

/** Bulk reschedule (one shared dueDate) — all-or-nothing, RLS-equivalent scoping. */
export async function bulkReschedule(
  userId: string,
  ids: string[],
  dueDate: string,
): Promise<BulkResult> {
  const { owned, skipped } = await partitionOwned(userId, ids);
  await prisma.$transaction([
    prisma.task.updateMany({
      where: { id: { in: owned }, userId },
      data: { dueDate: toDbDate(dueDate) },
    }),
  ]);
  return { applied: owned, skipped, tasksChanged: owned.length > 0 };
}

export async function bulkComplete(
  userId: string,
  ids: string[],
): Promise<BulkResult> {
  const { owned, skipped } = await partitionOwned(userId, ids);
  await prisma.$transaction([
    prisma.task.updateMany({
      where: { id: { in: owned }, userId },
      data: { status: "completed", completedAt: new Date() },
    }),
  ]);
  return { applied: owned, skipped, tasksChanged: owned.length > 0 };
}

export async function bulkDelete(
  userId: string,
  ids: string[],
): Promise<BulkResult> {
  const { owned, skipped } = await partitionOwned(userId, ids);
  await prisma.$transaction([
    prisma.task.deleteMany({ where: { id: { in: owned }, userId } }),
  ]);
  return { applied: owned, skipped, tasksChanged: owned.length > 0 };
}

"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import {
  createTask,
  deleteTask,
  setTaskStatus,
  updateTask,
} from "@/lib/data/tasks";
import type { TaskDTO } from "@/lib/types";

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const createSchema = z.object({
  content: z.string().trim().min(1).max(500),
  description: z.string().max(5000).nullish(),
  priority: z.number().int().min(1).max(4).optional(),
  dueDate: dateStr.nullish(),
  projectId: z.string().uuid().nullish(),
});

const updateSchema = z.object({
  content: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  priority: z.number().int().min(1).max(4).optional(),
  dueDate: dateStr.nullable().optional(),
  projectId: z.string().uuid().optional(),
});

export async function createTaskAction(
  input: z.infer<typeof createSchema>,
): Promise<TaskDTO> {
  const user = await requireUser();
  const data = createSchema.parse(input);
  return createTask(user.id, data);
}

export async function updateTaskAction(
  id: string,
  input: z.infer<typeof updateSchema>,
): Promise<TaskDTO> {
  const user = await requireUser();
  const data = updateSchema.parse(input);
  return updateTask(user.id, z.string().uuid().parse(id), data);
}

export async function completeTaskAction(id: string): Promise<TaskDTO> {
  const user = await requireUser();
  return setTaskStatus(user.id, z.string().uuid().parse(id), "completed");
}

export async function uncompleteTaskAction(id: string): Promise<TaskDTO> {
  const user = await requireUser();
  return setTaskStatus(user.id, z.string().uuid().parse(id), "active");
}

export async function deleteTaskAction(id: string): Promise<void> {
  const user = await requireUser();
  await deleteTask(user.id, z.string().uuid().parse(id));
}

const moveSchema = z.object({
  dueDate: dateStr,
  order: z.number(),
});

/**
 * Board move: reschedule a task to a day-column's date and set its order to the
 * computed drop position (TDD §5). Distinct from updateTask so the board has a
 * focused, validated path.
 */
export async function moveTaskAction(
  id: string,
  input: z.infer<typeof moveSchema>,
): Promise<TaskDTO> {
  const user = await requireUser();
  const data = moveSchema.parse(input);
  return updateTask(user.id, z.string().uuid().parse(id), data);
}

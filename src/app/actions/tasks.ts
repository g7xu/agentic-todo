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
import {
  createTaskSchema as createSchema,
  dateStr,
  updateTaskSchema as updateSchema,
} from "@/lib/validation/tasks";

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
  const task = await setTaskStatus(
    user.id,
    z.string().uuid().parse(id),
    "completed",
  );
  // Only re-opening can remove a row; completing always returns one.
  if (!task) throw new Error("Task not found");
  return task;
}

/** Resolves to null when the task was a routine day and re-opening removed it. */
export async function uncompleteTaskAction(
  id: string,
): Promise<TaskDTO | null> {
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

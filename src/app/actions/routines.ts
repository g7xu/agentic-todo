"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import {
  createRoutine,
  deleteRoutine,
  listRoutines,
  updateRoutine,
} from "@/lib/data/routines";
import type { RoutineDTO } from "@/lib/types";

const createSchema = z.object({
  content: z.string().trim().min(1).max(500),
  description: z.string().max(5000).nullish(),
  priority: z.number().int().min(1).max(4).optional(),
  projectId: z.string().uuid().nullish(),
});

const updateSchema = z.object({
  content: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  priority: z.number().int().min(1).max(4).optional(),
  projectId: z.string().uuid().optional(),
  active: z.boolean().optional(),
});

export async function listRoutinesAction(): Promise<RoutineDTO[]> {
  const user = await requireUser();
  return listRoutines(user.id);
}

export async function createRoutineAction(
  input: z.infer<typeof createSchema>,
): Promise<RoutineDTO> {
  const user = await requireUser();
  const data = createSchema.parse(input);
  return createRoutine(user.id, data);
}

export async function updateRoutineAction(
  id: string,
  input: z.infer<typeof updateSchema>,
): Promise<RoutineDTO> {
  const user = await requireUser();
  const data = updateSchema.parse(input);
  return updateRoutine(user.id, z.string().uuid().parse(id), data);
}

export async function deleteRoutineAction(id: string): Promise<void> {
  const user = await requireUser();
  await deleteRoutine(user.id, z.string().uuid().parse(id));
}

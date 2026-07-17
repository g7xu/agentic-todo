"use server";

import { z } from "zod";
import { MAX_EVERY } from "@/lib/repeat";
import { requireUser } from "@/lib/auth/session";
import {
  createRoutine,
  deleteRoutine,
  listRoutines,
  updateRoutine,
} from "@/lib/data/routines";
import type { RoutineDTO } from "@/lib/types";

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** `max(365)` above is only the widest unit's bound; each unit has its own
 * (MAX_EVERY). Reject an over-range count rather than let `normalizeRepeat`
 * silently clamp it, so a caller — the chat agent especially — is told no
 * instead of being handed back a routine it didn't ask for. An update that
 * changes the count without naming a unit can't be checked here (the unit lives
 * in the DB); normalizeRepeat still clamps that case. */
function checkEveryWithinUnit(
  v: { repeatEvery?: number; repeatUnit?: keyof typeof MAX_EVERY },
  ctx: z.RefinementCtx,
) {
  if (v.repeatEvery === undefined || v.repeatUnit === undefined) return;
  const max = MAX_EVERY[v.repeatUnit];
  if (v.repeatEvery > max) {
    ctx.addIssue({
      code: "custom",
      path: ["repeatEvery"],
      message: `must be at most ${max} when the unit is "${v.repeatUnit}"`,
    });
  }
}

const createSchema = z.object({
  content: z.string().trim().min(1).max(500),
  description: z.string().max(5000).nullish(),
  priority: z.number().int().min(1).max(4).optional(),
  projectId: z.string().uuid().nullish(),
  repeatEvery: z.number().int().min(1).max(365).optional(),
  repeatUnit: z.enum(["day", "week", "weekday", "month", "year"]).optional(),
  repeatWeekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  repeatBase: z.enum(["scheduled", "completed"]).optional(),
  endDate: dateStr.nullish(),
}).superRefine(checkEveryWithinUnit);

const updateSchema = z.object({
  content: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  priority: z.number().int().min(1).max(4).optional(),
  projectId: z.string().uuid().optional(),
  repeatEvery: z.number().int().min(1).max(365).optional(),
  repeatUnit: z.enum(["day", "week", "weekday", "month", "year"]).optional(),
  repeatWeekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  repeatBase: z.enum(["scheduled", "completed"]).optional(),
  endDate: dateStr.nullable().optional(),
  active: z.boolean().optional(),
}).superRefine(checkEveryWithinUnit);

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

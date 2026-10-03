import { z } from "zod";

/**
 * Task input schemas shared by the server actions and the MCP tools. A
 * `"use server"` module may only export async functions, which is why these
 * live here rather than beside the actions that first used them.
 */

/**
 * A real calendar day. The shape check alone lets `2026-02-30` through, and
 * the Date constructor would silently roll it to March 2nd; the round-trip
 * refuses anything that does not come back as the same string.
 */
function isCalendarDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine(isCalendarDate, "not a calendar date");

export const taskIdSchema = z.string().uuid();

/** Total minutes spent; the UI caps input at "99:59". */
export const timeUsedMin = z.number().int().min(0).max(5999);

/**
 * Expected minutes, capped at 24h — Todoist's cap, and a deliberate nudge to
 * split anything bigger (docs/ESTIMATES.md DE3). Looser than `timeUsedMin` on
 * purpose: tightening the stored-actuals bound would make an already-saved
 * value fail on its next save.
 */
export const estimateMin = z.number().int().min(0).max(1440);

export const createTaskSchema = z.object({
  content: z.string().trim().min(1).max(500),
  description: z.string().max(5000).nullish(),
  priority: z.number().int().min(1).max(4).optional(),
  dueDate: dateStr.nullish(),
  deadline: dateStr.nullish(),
  estimate: estimateMin.nullish(),
  timeUsed: timeUsedMin.nullish(),
  projectId: z.string().uuid().nullish(),
});

export const updateTaskSchema = z.object({
  content: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  priority: z.number().int().min(1).max(4).optional(),
  dueDate: dateStr.nullable().optional(),
  deadline: dateStr.nullable().optional(),
  estimate: estimateMin.nullable().optional(),
  timeUsed: timeUsedMin.nullable().optional(),
  projectId: z.string().uuid().optional(),
});

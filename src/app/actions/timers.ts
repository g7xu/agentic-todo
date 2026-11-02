"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getTask } from "@/lib/data/tasks";
import {
  discardTimer,
  getRunningTimer,
  startTimer,
  stopTimer,
} from "@/lib/data/timers";
import type { TaskDTO, TimerStateDTO } from "@/lib/types";

/** The timer after the action, plus the task whose time changed, if any, so
 * the client can patch its task list without refetching it. */
export type TimerActionResult = TimerStateDTO & { changed: TaskDTO | null };

async function result(
  userId: string,
  changedId: string | null,
): Promise<TimerActionResult> {
  const [timer, changed] = await Promise.all([
    getRunningTimer(userId),
    changedId ? getTask(userId, changedId) : null,
  ]);
  return { timer, now: new Date().toISOString(), changed };
}

/** `changed` is the task that was running before, now stopped. */
export async function startTimerAction(
  taskId: string,
): Promise<TimerActionResult> {
  const user = await requireUser();
  const stopped = await startTimer(user.id, z.string().uuid().parse(taskId));
  return result(user.id, stopped);
}

/** `endedAt` is an ISO timestamp, for the long-run prompt (docs/TIMERS.md DT4). */
export async function stopTimerAction(
  endedAt?: string,
): Promise<TimerActionResult> {
  const user = await requireUser();
  const at = z.string().datetime().optional().parse(endedAt);
  const stopped = await stopTimer(user.id, at ? new Date(at) : undefined);
  return result(user.id, stopped);
}

export async function discardTimerAction(): Promise<TimerActionResult> {
  const user = await requireUser();
  const discarded = await discardTimer(user.id);
  return result(user.id, discarded);
}

/**
 * Task timers (docs/TIMERS.md). A running timer is a `TimeEntry` with no
 * `endedAt`; nothing runs on the server between start and stop (DT1).
 *
 * Writers resolve to task ids rather than DTOs: this module sits below
 * `tasks.ts`, whose completion paths call `stopTimerOnTasks`.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/provisioning";
import { sessionMinutes, TIME_USED_MAX } from "@/lib/timer";
import type { RunningTimerDTO } from "@/lib/types";

type OpenEntry = { id: string; taskId: string; startedAt: Date };

const OPEN_SELECT = { id: true, taskId: true, startedAt: true } as const;

const open = (userId: string) => ({ userId, endedAt: null });

/**
 * The only writer of `endedAt`. Adds the session to the task's `timeUsed`,
 * clamped to its bound, or deletes the entry when it rounds to 0 so a
 * misclick leaves no trace (DT6).
 *
 * Two requests can read the same open entry and both try to close it (two
 * tabs starting timers at once). Each write is therefore conditional on the
 * entry still being open: the second one waits on the first's row lock, then
 * matches nothing and adds nothing, so a session is never counted twice.
 */
async function closeEntry(
  tx: Prisma.TransactionClient,
  entry: OpenEntry,
  endedAt: Date,
): Promise<void> {
  const stillOpen = { id: entry.id, endedAt: null };
  const minutes = sessionMinutes(entry.startedAt, endedAt);
  if (minutes === 0) {
    await tx.timeEntry.deleteMany({ where: stillOpen });
    return;
  }
  const closed = await tx.timeEntry.updateMany({
    where: stillOpen,
    data: { endedAt },
  });
  if (closed.count === 0) return;
  const task = await tx.task.findUniqueOrThrow({
    where: { id: entry.taskId },
    select: { timeUsed: true },
  });
  await tx.task.update({
    where: { id: entry.taskId },
    data: { timeUsed: Math.min(TIME_USED_MAX, (task.timeUsed ?? 0) + minutes) },
  });
}

export async function getRunningTimer(
  userId: string,
): Promise<RunningTimerDTO | null> {
  const e = await prisma.timeEntry.findFirst({
    where: open(userId),
    select: {
      startedAt: true,
      task: {
        select: { id: true, content: true, estimate: true, timeUsed: true },
      },
    },
  });
  if (!e) return null;
  return {
    taskId: e.task.id,
    content: e.task.content,
    estimate: e.task.estimate,
    timeUsed: e.task.timeUsed,
    startedAt: e.startedAt.toISOString(),
  };
}

/**
 * Starts timing `taskId`, first stopping whatever else runs (DT3). Resolves
 * to the id of the task that was stopped, or null.
 *
 * Starting the task that is already running is a no-op, so a double click
 * doesn't cut the session in two. Two starts racing past the open-entry read
 * collide on the one-running-per-user index; the loser retries once, stopping
 * the winner's entry, so the last click wins.
 */
export async function startTimer(
  userId: string,
  taskId: string,
): Promise<string | null> {
  const attempt = () =>
    prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: { id: taskId, userId },
        select: { status: true, routineId: true },
      });
      if (!task) throw new Error("Task not found");
      if (task.status !== "active")
        throw new Error("Only open tasks can be timed");
      if (task.routineId) throw new Error("Routine days can't be timed");

      const current = await tx.timeEntry.findFirst({
        where: open(userId),
        select: OPEN_SELECT,
      });
      if (current?.taskId === taskId) return null;

      const now = new Date();
      if (current) await closeEntry(tx, current, now);
      await tx.timeEntry.create({ data: { userId, taskId, startedAt: now } });
      return current?.taskId ?? null;
    });

  try {
    return await attempt();
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return attempt();
  }
}

/**
 * Stops the running timer at `endedAt`, default now. `endedAt` is how the
 * long-run prompt (DT4) records when work really ended, so it must fall
 * between the start and now. Resolves to the stopped task's id, or null when
 * nothing was running, which makes a repeated stop harmless.
 */
export async function stopTimer(
  userId: string,
  endedAt?: Date,
): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.timeEntry.findFirst({
      where: open(userId),
      select: OPEN_SELECT,
    });
    if (!current) return null;

    const now = new Date();
    const end = endedAt ?? now;
    if (end.getTime() > now.getTime()) {
      throw new Error("Stop time can't be in the future");
    }
    if (end.getTime() < current.startedAt.getTime()) {
      throw new Error("Stop time is before the timer started");
    }
    await closeEntry(tx, current, end);
    return current.taskId;
  });
}

/** Drops the running session without recording any time. */
export async function discardTimer(userId: string): Promise<string | null> {
  const current = await prisma.timeEntry.findFirst({
    where: open(userId),
    select: OPEN_SELECT,
  });
  if (!current) return null;
  await prisma.timeEntry.deleteMany({ where: { id: current.id, userId } });
  return current.taskId;
}

/**
 * Stops the running timer if it is on one of `taskIds`, recording the session
 * up to now. Called by every completion path before it writes, so completing
 * through the app or an MCP client stops the timer too (DT5). The common case,
 * no timer on these tasks, costs one read and no transaction.
 */
export async function stopTimerOnTasks(
  userId: string,
  taskIds: string[],
): Promise<void> {
  if (taskIds.length === 0) return;
  const current = await prisma.timeEntry.findFirst({
    where: { ...open(userId), taskId: { in: taskIds } },
    select: OPEN_SELECT,
  });
  if (!current) return;
  await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction: a stop from another tab may have
    // closed it since.
    const still = await tx.timeEntry.findFirst({
      where: { id: current.id, endedAt: null },
      select: OPEN_SELECT,
    });
    if (still) await closeEntry(tx, still, new Date());
  });
}

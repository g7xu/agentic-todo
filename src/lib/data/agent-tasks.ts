import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { TASK_SELECT, taskToDTO } from "@/lib/data/tasks";
import { stopTimerOnTasks } from "@/lib/data/timers";
import type { AgentState, TaskActivityDTO, TaskDTO } from "@/lib/types";

/**
 * The hand-off between the user and an agent working their list unattended
 * (docs/AGENT-TASKS.md). Every transition here is a conditional write on the
 * state it expects, so two scheduled runs racing on one task cannot both win
 * (AT3), and a run whose claim was taken over cannot write over the new one.
 */

/** How long a claim lasts when the agent names no lease. */
export const DEFAULT_LEASE_MIN = 30;
/** The longest single lease; long work extends it with progress notes. */
export const MAX_LEASE_MIN = 240;
/** Log entries returned with a claimed task, newest last. */
const CLAIM_LOG_LIMIT = 20;

/** Messages a caller (the MCP layer) may show as-is. */
export const AGENT_ERRORS = {
  notFound: "Task not found",
  notActive: "Task is no longer active",
  routine: "Routine tasks can't be handed to the agent",
  notReady: "Task is not ready for the agent",
  claimedElsewhere: "Task is claimed by another run",
  claimLost: "This run no longer holds the claim on that task",
  noQuestion: "Task is not waiting on an answer",
} as const;

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function activityDTO(a: {
  id: string;
  author: string;
  kind: string;
  content: string;
  createdAt: Date;
}): TaskActivityDTO {
  return {
    id: a.id,
    author: a.author as TaskActivityDTO["author"],
    kind: a.kind as TaskActivityDTO["kind"],
    content: a.content,
    createdAt: a.createdAt.toISOString(),
  };
}

async function log(
  tx: Tx,
  userId: string,
  taskId: string,
  author: TaskActivityDTO["author"],
  kind: TaskActivityDTO["kind"],
  content: string,
): Promise<void> {
  await tx.taskActivity.create({
    data: { userId, taskId, author, kind, content },
  });
}

async function reload(tx: Tx, userId: string, id: string): Promise<TaskDTO> {
  const t = await tx.task.findFirst({ where: { id, userId }, select: TASK_SELECT });
  if (!t) throw new Error(AGENT_ERRORS.notFound);
  return taskToDTO(t);
}

/** The newest `limit` log entries of a task, oldest first. */
export async function listTaskActivity(
  userId: string,
  taskId: string,
  limit = 100,
): Promise<TaskActivityDTO[]> {
  const rows = await prisma.taskActivity.findMany({
    where: { userId, taskId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.reverse().map(activityDTO);
}

// --- the user's side ------------------------------------------------------

/**
 * Hands a task to the agent (AT1), including accepting one it suggested and
 * handing back one it already finished. A task the agent is working or
 * waiting on is left as it is, so a second click changes nothing.
 */
export async function handToAgent(userId: string, id: string): Promise<TaskDTO> {
  const t = await prisma.task.findFirst({
    where: { id, userId },
    select: { status: true, routineId: true, agentState: true },
  });
  if (!t) throw new Error(AGENT_ERRORS.notFound);
  if (t.routineId) throw new Error(AGENT_ERRORS.routine);
  if (t.status !== "active") throw new Error(AGENT_ERRORS.notActive);
  return prisma.$transaction(async (tx) => {
    await tx.task.updateMany({
      where: {
        id,
        userId,
        status: "active",
        OR: [{ agentState: null }, { agentState: { in: ["suggested", "done"] } }],
      },
      data: { agentState: "ready" },
    });
    return reload(tx, userId, id);
  });
}

/**
 * Takes a task back from the agent whatever its state: a working run loses
 * its claim and its next write fails (AT3). The log is kept.
 */
export async function takeBackFromAgent(userId: string, id: string): Promise<TaskDTO> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.task.updateMany({
      where: { id, userId },
      data: { agentState: null, agentQuestion: null, claimId: null, claimExpiresAt: null },
    });
    if (count === 0) throw new Error(AGENT_ERRORS.notFound);
    return reload(tx, userId, id);
  });
}

/** The user's answer goes into the log and the task returns to the queue (AT4). */
export async function answerAgent(
  userId: string,
  id: string,
  answer: string,
): Promise<TaskDTO> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.task.updateMany({
      where: { id, userId, agentState: "needs_input" },
      data: { agentState: "ready", agentQuestion: null },
    });
    if (count === 0) {
      const exists = await tx.task.findFirst({ where: { id, userId }, select: { id: true } });
      throw new Error(exists ? AGENT_ERRORS.noQuestion : AGENT_ERRORS.notFound);
    }
    await log(tx, userId, id, "user", "answer", answer);
    return reload(tx, userId, id);
  });
}

// --- the agent's side -----------------------------------------------------

export type ClaimedTask = {
  task: TaskDTO;
  claimId: string;
  claimExpiresAt: string;
  /** Earlier questions, answers and notes, so a run picks up where the last stopped. */
  log: TaskActivityDTO[];
};

/** A task a run may claim: handed over and unclaimed, or claimed by a run whose lease ran out. */
function claimable(now: Date) {
  return {
    status: "active",
    OR: [
      { agentState: "ready" },
      { agentState: "working", claimExpiresAt: { lt: now } },
    ],
  };
}

/**
 * Claims one task for one run (AT3). With an id, that task; without, the
 * next claimable task by priority, then deadline, then planned date. The
 * claim is a compare-and-set on the claimable condition, so of two runs
 * racing for one task exactly one succeeds; the loser moves to the next
 * candidate. Returns null when nothing is waiting.
 */
export async function claimTask(
  userId: string,
  opts: { id?: string; leaseMinutes?: number } = {},
): Promise<ClaimedTask | null> {
  const lease = Math.min(Math.max(opts.leaseMinutes ?? DEFAULT_LEASE_MIN, 1), MAX_LEASE_MIN);
  const now = new Date();

  let candidates: string[];
  if (opts.id) {
    const t = await prisma.task.findFirst({
      where: { id: opts.id, userId },
      select: { status: true, agentState: true, claimExpiresAt: true },
    });
    if (!t) throw new Error(AGENT_ERRORS.notFound);
    if (t.status !== "active") throw new Error(AGENT_ERRORS.notActive);
    if (t.agentState === "working" && t.claimExpiresAt && t.claimExpiresAt >= now) {
      throw new Error(AGENT_ERRORS.claimedElsewhere);
    }
    if (t.agentState !== "ready" && t.agentState !== "working") {
      throw new Error(AGENT_ERRORS.notReady);
    }
    candidates = [opts.id];
  } else {
    const rows = await prisma.task.findMany({
      where: { userId, ...claimable(now) },
      orderBy: [
        { priority: "asc" },
        { deadline: { sort: "asc", nulls: "last" } },
        { dueDate: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
      ],
      select: { id: true },
      take: 10,
    });
    candidates = rows.map((r) => r.id);
  }

  for (const id of candidates) {
    const claimId = randomUUID();
    const expiresAt = new Date(now.getTime() + lease * 60_000);
    const { count } = await prisma.task.updateMany({
      where: { id, userId, ...claimable(now) },
      data: { agentState: "working", claimId, claimExpiresAt: expiresAt },
    });
    if (count === 1) {
      const [task, log] = await Promise.all([
        prisma.task.findFirst({ where: { id, userId }, select: TASK_SELECT }),
        listTaskActivity(userId, id, CLAIM_LOG_LIMIT),
      ]);
      if (!task) throw new Error(AGENT_ERRORS.notFound);
      return {
        task: taskToDTO(task),
        claimId,
        claimExpiresAt: expiresAt.toISOString(),
        log,
      };
    }
  }
  if (opts.id) throw new Error(AGENT_ERRORS.claimedElsewhere);
  return null;
}

/**
 * The condition every write by a claiming run carries. The lease is not
 * checked: once it runs out another run may take the task over, which
 * replaces `claimId`, so a matching id proves nobody has (AT3).
 */
function held(userId: string, id: string, claimId: string) {
  return { id, userId, claimId, agentState: "working", status: "active" };
}

async function claimLostReason(tx: Tx, userId: string, id: string): Promise<string> {
  const t = await tx.task.findFirst({ where: { id, userId }, select: { status: true } });
  if (!t) return AGENT_ERRORS.notFound;
  if (t.status !== "active") return AGENT_ERRORS.notActive;
  return AGENT_ERRORS.claimLost;
}

/** A transition out of 'working' that drops the claim and logs one entry. */
async function leaveWorking(
  userId: string,
  id: string,
  claimId: string,
  next: { agentState: AgentState; agentQuestion?: string | null },
  entry: { kind: TaskActivityDTO["kind"]; content: string } | null,
): Promise<TaskDTO> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.task.updateMany({
      where: held(userId, id, claimId),
      data: {
        agentState: next.agentState,
        agentQuestion: next.agentQuestion ?? null,
        claimId: null,
        claimExpiresAt: null,
      },
    });
    if (count === 0) throw new Error(await claimLostReason(tx, userId, id));
    if (entry) await log(tx, userId, id, "agent", entry.kind, entry.content);
    return reload(tx, userId, id);
  });
}

/** A progress note; it also renews the lease for long work. */
export async function logProgress(
  userId: string,
  id: string,
  claimId: string,
  note: string,
  leaseMinutes = DEFAULT_LEASE_MIN,
): Promise<{ claimExpiresAt: string }> {
  const lease = Math.min(Math.max(leaseMinutes, 1), MAX_LEASE_MIN);
  const expiresAt = new Date(Date.now() + lease * 60_000);
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.task.updateMany({
      where: held(userId, id, claimId),
      data: { claimExpiresAt: expiresAt },
    });
    if (count === 0) throw new Error(await claimLostReason(tx, userId, id));
    await log(tx, userId, id, "agent", "progress", note);
    return { claimExpiresAt: expiresAt.toISOString() };
  });
}

/** Parks the task on the user with one question (AT4). */
export function requestInput(
  userId: string,
  id: string,
  claimId: string,
  question: string,
): Promise<TaskDTO> {
  return leaveWorking(
    userId,
    id,
    claimId,
    { agentState: "needs_input", agentQuestion: question },
    { kind: "question", content: question },
  );
}

/** Gives the task back to the queue without finishing it. */
export function releaseTask(
  userId: string,
  id: string,
  claimId: string,
  note: string | undefined,
): Promise<TaskDTO> {
  return leaveWorking(
    userId,
    id,
    claimId,
    { agentState: "ready" },
    note ? { kind: "released", content: note } : null,
  );
}

/**
 * Logs the report and completes the task (AT5). Completion follows
 * `setTaskStatus`: a running timer is stopped first.
 */
export async function finishTask(
  userId: string,
  id: string,
  claimId: string,
  report: string,
): Promise<TaskDTO> {
  const holder = await prisma.task.findFirst({
    where: held(userId, id, claimId),
    select: { id: true },
  });
  if (holder) await stopTimerOnTasks(userId, [id]);
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.task.updateMany({
      where: held(userId, id, claimId),
      data: {
        agentState: "done",
        agentQuestion: null,
        claimId: null,
        claimExpiresAt: null,
        status: "completed",
        completedAt: new Date(),
      },
    });
    if (count === 0) throw new Error(await claimLostReason(tx, userId, id));
    await log(tx, userId, id, "agent", "report", report);
    return reload(tx, userId, id);
  });
}

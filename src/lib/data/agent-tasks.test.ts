import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";

type TaskRow = {
  id: string;
  userId: string;
  projectId: string;
  routineId: string | null;
  content: string;
  description: string | null;
  priority: number;
  dueDate: Date | null;
  deadline: Date | null;
  estimate: number | null;
  timeUsed: number | null;
  status: string;
  order: number;
  completedAt: Date | null;
  createdAt: Date;
  agentState: string | null;
  agentQuestion: string | null;
  claimId: string | null;
  claimExpiresAt: Date | null;
};

type ActivityRow = {
  id: string;
  userId: string;
  taskId: string;
  author: string;
  kind: string;
  content: string;
  createdAt: Date;
};

/**
 * An in-memory stand-in for the slice of Prisma the hand-off calls, so each
 * test asserts the rows that result. `where` supports equality (null
 * included), `in`, `lt` and a top-level `OR`; anything else throws instead of
 * silently matching everything. Each call yields once, so two `claimTask`
 * calls started together interleave the way two scheduled runs would.
 */
const db = vi.hoisted(() => {
  const tasks: TaskRow[] = [];
  const activities: ActivityRow[] = [];
  let seq = 0;

  function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, cond]) => {
      if (key === "OR") {
        return (cond as Record<string, unknown>[]).some((w) => matches(row, w));
      }
      const value = row[key];
      if (cond instanceof Date) {
        return value instanceof Date && value.getTime() === cond.getTime();
      }
      if (cond === null || typeof cond !== "object") return value === cond;
      const ops = cond as { in?: unknown[]; lt?: Date };
      for (const op of Object.keys(ops)) {
        if (op !== "in" && op !== "lt") {
          throw new Error(`fake prisma: unsupported operator ${op}`);
        }
      }
      if (ops.in !== undefined && !ops.in.includes(value)) return false;
      if (ops.lt !== undefined) {
        if (!(value instanceof Date) || value.getTime() >= ops.lt.getTime()) return false;
      }
      return true;
    });
  }

  type Order = Record<string, "asc" | "desc" | { sort: "asc" | "desc"; nulls: "last" }>;
  function sortBy<T extends Record<string, unknown>>(rows: T[], orderBy: Order | Order[] | undefined): T[] {
    const keys = orderBy === undefined ? [] : Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((a, b) => {
      for (const o of keys) {
        const [field, spec] = Object.entries(o)[0];
        const dir = typeof spec === "string" ? spec : spec.sort;
        const av = a[field] instanceof Date ? (a[field] as Date).getTime() : a[field];
        const bv = b[field] instanceof Date ? (b[field] as Date).getTime() : b[field];
        if (av === bv) continue;
        if (av === null) return 1;
        if (bv === null) return -1;
        const cmp = (av as number) < (bv as number) ? -1 : 1;
        return dir === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  const prisma = {
    task: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        await tick();
        const hit = tasks.find((t) => matches(t, where));
        return hit ? { ...hit } : null;
      },
      findMany: async (args: { where: Record<string, unknown>; orderBy?: Order[]; take?: number }) => {
        await tick();
        const hits = sortBy(tasks.filter((t) => matches(t, args.where)), args.orderBy);
        return hits.slice(0, args.take ?? hits.length).map((t) => ({ ...t }));
      },
      updateMany: async (args: { where: Record<string, unknown>; data: Partial<TaskRow> }) => {
        await tick();
        const hits = tasks.filter((t) => matches(t, args.where));
        for (const t of hits) Object.assign(t, args.data);
        return { count: hits.length };
      },
      aggregate: async ({ where }: { where: Record<string, unknown> }) => {
        const orders = tasks.filter((t) => matches(t, where)).map((t) => t.order);
        return { _max: { order: orders.length ? Math.max(...orders) : null } };
      },
      create: async ({ data }: { data: Partial<TaskRow> }) => {
        const row = {
          id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "9")}`,
          routineId: null,
          status: "active", // the column default
          completedAt: null,
          createdAt: new Date(),
          agentQuestion: null,
          claimId: null,
          claimExpiresAt: null,
          ...data,
        } as TaskRow;
        tasks.push(row);
        return { ...row };
      },
    },
    taskActivity: {
      create: async ({ data }: { data: Omit<ActivityRow, "id" | "createdAt"> }) => {
        const row = { id: `act-${++seq}`, createdAt: new Date(Date.now() + seq), ...data };
        activities.push(row);
        return { ...row };
      },
      findMany: async (args: { where: Record<string, unknown>; orderBy?: Order; take?: number }) => {
        const hits = sortBy(activities.filter((a) => matches(a, args.where)), args.orderBy);
        return hits.slice(0, args.take ?? hits.length).map((a) => ({ ...a }));
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };

  return { tasks, activities, prisma };
});

vi.mock("@/lib/db", () => ({ prisma: db.prisma }));
vi.mock("@/lib/data/timers", () => ({ stopTimerOnTasks: vi.fn() }));
vi.mock("@/lib/data/projects", () => ({
  getInboxId: async () => INBOX,
  userOwnsProject: async () => true,
}));

import { stopTimerOnTasks } from "@/lib/data/timers";
import { registerTools } from "@/lib/mcp/tools";
import {
  AGENT_ERRORS,
  answerAgent,
  claimTask,
  finishTask,
  handToAgent,
  logProgress,
  releaseTask,
  requestInput,
  takeBackFromAgent,
} from "./agent-tasks";

const USER = "00000000-0000-4000-8000-0000000000aa";
const OTHER_USER = "00000000-0000-4000-8000-0000000000bb";
const INBOX = "00000000-0000-4000-8000-0000000000cc";
const NOW = new Date("2026-11-11T12:00:00Z");

const URGENT = "00000000-0000-4000-8000-000000000001";
const LATER = "00000000-0000-4000-8000-000000000002";
const PERSONAL = "00000000-0000-4000-8000-000000000003";
const SUGGESTED = "00000000-0000-4000-8000-000000000004";
const ROUTINE_DAY = "00000000-0000-4000-8000-000000000005";
const FOREIGN = "00000000-0000-4000-8000-000000000006";

function row(id: string, fields: Partial<TaskRow>): TaskRow {
  return {
    id,
    userId: USER,
    projectId: INBOX,
    routineId: null,
    content: id,
    description: null,
    priority: 4,
    dueDate: null,
    deadline: null,
    estimate: null,
    timeUsed: null,
    status: "active",
    order: 1,
    completedAt: null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    agentState: null,
    agentQuestion: null,
    claimId: null,
    claimExpiresAt: null,
    ...fields,
  };
}

const stored = (id: string) => db.tasks.find((t) => t.id === id)!;
const logOf = (id: string) =>
  db.activities.filter((a) => a.taskId === id).map((a) => [a.author, a.kind, a.content]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  vi.mocked(stopTimerOnTasks).mockClear();
  db.activities.length = 0;
  db.tasks.splice(
    0,
    db.tasks.length,
    row(LATER, { agentState: "ready", priority: 3 }),
    row(URGENT, { agentState: "ready", priority: 1, description: "Jason's notes" }),
    row(PERSONAL, { priority: 1 }),
    row(SUGGESTED, { agentState: "suggested", priority: 1 }),
    row(ROUTINE_DAY, { routineId: "00000000-0000-4000-8000-0000000000dd" }),
    row(FOREIGN, { userId: OTHER_USER, agentState: "ready", priority: 1 }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("claimTask", () => {
  it("claims the most urgent task handed to the agent, and only the user's", async () => {
    const claimed = await claimTask(USER);
    expect(claimed?.task.id).toBe(URGENT);
    expect(claimed?.claimExpiresAt).toBe(new Date(NOW.getTime() + 30 * 60_000).toISOString());
    expect(stored(URGENT)).toMatchObject({
      agentState: "working",
      claimId: claimed?.claimId,
    });
    expect(stored(PERSONAL).agentState).toBeNull();
    expect(stored(FOREIGN).agentState).toBe("ready");
  });

  it("lets exactly one of two racing runs claim the last task", async () => {
    stored(LATER).agentState = null;
    const [a, b] = await Promise.all([claimTask(USER), claimTask(USER)]);
    const winners = [a, b].filter((c) => c !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.task.id).toBe(URGENT);
  });

  it("returns null when nothing is waiting", async () => {
    stored(LATER).agentState = null;
    stored(URGENT).agentState = null;
    expect(await claimTask(USER)).toBeNull();
  });

  it("refuses a task by id that is claimed, personal or suggested", async () => {
    await claimTask(USER, { id: URGENT });
    await expect(claimTask(USER, { id: URGENT })).rejects.toThrow(AGENT_ERRORS.claimedElsewhere);
    await expect(claimTask(USER, { id: PERSONAL })).rejects.toThrow(AGENT_ERRORS.notReady);
    await expect(claimTask(USER, { id: SUGGESTED })).rejects.toThrow(AGENT_ERRORS.notReady);
    await expect(claimTask(USER, { id: FOREIGN })).rejects.toThrow(AGENT_ERRORS.notFound);
  });

  it("takes over a lapsed claim, after which the first run's writes fail", async () => {
    const first = await claimTask(USER, { id: URGENT, leaseMinutes: 5 });
    vi.setSystemTime(new Date(NOW.getTime() + 6 * 60_000));
    const second = await claimTask(USER, { id: URGENT });
    expect(second?.claimId).not.toBe(first?.claimId);
    await expect(finishTask(USER, URGENT, first!.claimId, "done")).rejects.toThrow(
      AGENT_ERRORS.claimLost,
    );
    expect(stored(URGENT).status).toBe("active");
  });
});

describe("working a claimed task", () => {
  it("renews the lease with each progress note", async () => {
    const c = (await claimTask(USER, { id: URGENT }))!;
    vi.setSystemTime(new Date(NOW.getTime() + 20 * 60_000));
    const { claimExpiresAt } = await logProgress(USER, URGENT, c.claimId, "Found three options", 60);
    expect(claimExpiresAt).toBe(new Date(NOW.getTime() + 80 * 60_000).toISOString());
    expect(logOf(URGENT)).toEqual([["agent", "progress", "Found three options"]]);
  });

  it("parks a question on the user and resumes with their answer in the log", async () => {
    const c = (await claimTask(USER, { id: URGENT }))!;
    const parked = await requestInput(USER, URGENT, c.claimId, "Window or aisle?");
    expect(parked).toMatchObject({ agentState: "needs_input", agentQuestion: "Window or aisle?" });
    expect(stored(URGENT).claimId).toBeNull();

    await answerAgent(USER, URGENT, "Aisle");
    expect(stored(URGENT)).toMatchObject({ agentState: "ready", agentQuestion: null });

    const again = await claimTask(USER, { id: URGENT });
    expect(again?.log.map((e) => [e.author, e.kind, e.content])).toEqual([
      ["agent", "question", "Window or aisle?"],
      ["user", "answer", "Aisle"],
    ]);
  });

  it("refuses an answer to a task that asked nothing", async () => {
    await expect(answerAgent(USER, URGENT, "Aisle")).rejects.toThrow(AGENT_ERRORS.noQuestion);
  });

  it("finishes with a report in the log and the description untouched", async () => {
    const c = (await claimTask(USER, { id: URGENT }))!;
    const done = await finishTask(USER, URGENT, c.claimId, "Booked nothing; drafted the email");
    expect(done).toMatchObject({ status: "completed", agentState: "done", description: "Jason's notes" });
    expect(stored(URGENT)).toMatchObject({ claimId: null, completedAt: NOW });
    expect(stopTimerOnTasks).toHaveBeenCalledWith(USER, [URGENT]);
    expect(logOf(URGENT)).toEqual([["agent", "report", "Booked nothing; drafted the email"]]);
  });

  it("puts a released task back in the queue with a note for the next run", async () => {
    const c = (await claimTask(USER, { id: URGENT }))!;
    await releaseTask(USER, URGENT, c.claimId, "Site was down");
    expect(stored(URGENT)).toMatchObject({ agentState: "ready", claimId: null });
    expect(logOf(URGENT)).toEqual([["agent", "released", "Site was down"]]);
  });

  it("stops a run once the user takes the task back or completes it", async () => {
    const c = (await claimTask(USER, { id: URGENT }))!;
    await takeBackFromAgent(USER, URGENT);
    await expect(finishTask(USER, URGENT, c.claimId, "x")).rejects.toThrow(AGENT_ERRORS.claimLost);

    const d = (await claimTask(USER, { id: LATER }))!;
    stored(LATER).status = "completed";
    await expect(logProgress(USER, LATER, d.claimId, "x")).rejects.toThrow(AGENT_ERRORS.notActive);
  });
});

describe("handToAgent", () => {
  it("turns a suggestion or a personal task into a ready one", async () => {
    expect((await handToAgent(USER, SUGGESTED)).agentState).toBe("ready");
    expect((await handToAgent(USER, PERSONAL)).agentState).toBe("ready");
  });

  it("leaves a task that is being worked as it is", async () => {
    const c = (await claimTask(USER, { id: URGENT }))!;
    expect((await handToAgent(USER, URGENT)).agentState).toBe("working");
    expect(stored(URGENT).claimId).toBe(c.claimId);
  });

  it("refuses a routine day", async () => {
    await expect(handToAgent(USER, ROUTINE_DAY)).rejects.toThrow(AGENT_ERRORS.routine);
  });
});

// --- the MCP surface ------------------------------------------------------

type Result = { isError?: boolean; content: { text: string }[] };
type Handler = (args: unknown, ctx: ServerContext) => Promise<Result>;

function call(name: string, args: unknown, scopes: string[]) {
  const byName = new Map<string, Handler>();
  registerTools({
    registerTool: (n: string, _config: unknown, handler: Handler) => byName.set(n, handler),
    registerPrompt: () => undefined,
  } as unknown as McpServer);
  const ctx = {
    http: { authInfo: { scopes, extra: { userId: USER } } },
  } as unknown as ServerContext;
  return byName.get(name)!(args, ctx);
}

describe("hand-off tools", () => {
  it("claims through the tool on an agent-only connection", async () => {
    const claimed = await call("claim_task", {}, ["tasks:read", "tasks:agent"]);
    expect(claimed.isError).toBeFalsy();
    const body = JSON.parse(claimed.content[0].text);
    expect(body.task.id).toBe(URGENT);
    expect(body.claimId).toBe(stored(URGENT).claimId);
    expect(body.claimExpiresAt).toBeTruthy();
    expect(Array.isArray(body.log)).toBe(true);
  });

  it("suggests a task the agent cannot claim until the user hands it over", async () => {
    const res = await call("suggest_task", { content: "Reply to the landlord" }, ["tasks:agent"]);
    expect(res.isError).toBeFalsy();
    const id = JSON.parse(res.content[0].text).id as string;
    expect(stored(id).agentState).toBe("suggested");
    const refused = await call("claim_task", { id }, ["tasks:agent"]);
    expect(refused).toMatchObject({ isError: true, content: [{ text: AGENT_ERRORS.notReady }] });
  });

  it("keeps an agent-only connection away from general edits and deletes", async () => {
    for (const name of ["delete_tasks", "update_task", "complete_tasks", "reschedule_tasks"]) {
      const args =
        name === "update_task"
          ? { id: URGENT }
          : name === "reschedule_tasks"
            ? { ids: [URGENT], dueDate: "2026-12-01" }
            : { ids: [URGENT] };
      const res = await call(name, args, ["tasks:read", "tasks:agent"]);
      expect(res.isError, name).toBe(true);
      expect(res.content[0].text, name).toMatch(/hand-off tools/);
    }
    expect(stored(URGENT)).toBeDefined();
  });

  it("keeps a read-only connection away from the hand-off", async () => {
    const res = await call("claim_task", {}, ["tasks:read"]);
    expect(res.isError).toBe(true);
    expect(stored(URGENT).agentState).toBe("ready");
  });

  it("returns { task: null } when nothing is waiting", async () => {
    for (const t of db.tasks) if (t.agentState === "ready") t.agentState = null;
    const res = await call("claim_task", {}, ["tasks:agent"]);
    expect(JSON.parse(res.content[0].text)).toEqual({ task: null });
  });

  it("finishes and claims the next ready task in one call with next: true", async () => {
    const first = JSON.parse((await call("claim_task", {}, ["tasks:agent"])).content[0].text);
    const res = await call(
      "finish_task",
      { id: first.task.id, claimId: first.claimId, report: "Done.", next: true },
      ["tasks:agent"],
    );
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.content[0].text);
    expect(body.task).toMatchObject({ id: first.task.id, status: "completed", agentState: "done" });
    expect(body.next.task.id).not.toBe(first.task.id);
    expect(stored(body.next.task.id)).toMatchObject({ agentState: "working", claimId: body.next.claimId });
  });

  it("leaves next out unless asked, and returns { task } from every leaving move", async () => {
    const first = JSON.parse((await call("claim_task", {}, ["tasks:agent"])).content[0].text);
    const asked = JSON.parse(
      (await call("request_input", { id: first.task.id, claimId: first.claimId, question: "Which one?" }, ["tasks:agent"]))
        .content[0].text,
    );
    expect(Object.keys(asked)).toEqual(["task"]);
    expect(asked.task.agentState).toBe("needs_input");
    const second = JSON.parse((await call("claim_task", {}, ["tasks:agent"])).content[0].text);
    const released = JSON.parse(
      (await call("release_task", { id: second.task.id, claimId: second.claimId }, ["tasks:agent"])).content[0].text,
    );
    expect(Object.keys(released)).toEqual(["task"]);
    expect(released.task.agentState).toBe("ready");
  });

  it("asks and claims the next task with next: true, reporting { task: null } when the queue is empty", async () => {
    const first = JSON.parse((await call("claim_task", { id: URGENT }, ["tasks:agent"])).content[0].text);
    for (const t of db.tasks) if (t.agentState === "ready") t.agentState = null;
    const body = JSON.parse(
      (await call("request_input", { id: URGENT, claimId: first.claimId, question: "Which one?", next: true }, ["tasks:agent"]))
        .content[0].text,
    );
    expect(body.task.agentState).toBe("needs_input");
    expect(body.next).toEqual({ task: null });
  });

  it("lets a full-access connection use the hand-off too", async () => {
    const res = await call("claim_task", { id: LATER }, ["tasks:read", "tasks:write"]);
    expect(res.isError).toBeFalsy();
    expect(stored(LATER).agentState).toBe("working");
  });
});

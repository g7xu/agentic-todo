import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InMemoryTransport,
  McpServer,
  type JSONRPCMessage,
} from "@modelcontextprotocol/server";

type Row = {
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
};

/**
 * An in-memory stand-in for the slice of Prisma these paths call, so a test
 * asserts the rows that result rather than the queries that were sent. `where`
 * supports equality, `in` and `not`; anything else throws instead of silently
 * matching everything.
 */
const db = vi.hoisted(() => {
  const tasks: Row[] = [];

  function matches(row: Row, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, cond]) => {
      const value = row[key as keyof Row];
      if (cond instanceof Date) {
        return value instanceof Date && value.getTime() === cond.getTime();
      }
      if (cond === null || typeof cond !== "object") return value === cond;
      const ops = cond as { in?: unknown[]; not?: unknown };
      for (const op of Object.keys(ops)) {
        if (op !== "in" && op !== "not") {
          throw new Error(`fake prisma: unsupported operator ${op}`);
        }
      }
      if (ops.in !== undefined && !ops.in.includes(value)) return false;
      if ("not" in ops && value === ops.not) return false;
      return true;
    });
  }

  const find = (where: Record<string, unknown>) =>
    tasks.filter((t) => matches(t, where));

  const prisma = {
    task: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const hit = find(where)[0];
        return hit ? { ...hit } : null;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        find(where).map((t) => ({ ...t })),
      update: async (args: {
        where: Record<string, unknown>;
        data: Partial<Row>;
      }) => {
        const hit = find(args.where)[0];
        if (!hit) throw new Error("fake prisma: record to update not found");
        Object.assign(hit, args.data);
        return { ...hit };
      },
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Partial<Row>;
      }) => {
        const hits = find(args.where);
        for (const t of hits) Object.assign(t, args.data);
        return { count: hits.length };
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const hits = new Set(find(where));
        const kept = tasks.filter((t) => !hits.has(t));
        tasks.splice(0, tasks.length, ...kept);
        return { count: hits.size };
      },
    },
    profile: {
      findUnique: async () => ({ timezone: "UTC" }),
    },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  };

  return { tasks, prisma };
});

vi.mock("@/lib/db", () => ({ prisma: db.prisma }));

import { registerTools } from "@/lib/mcp/tools";
import { bulkComplete, setTaskStatus } from "./tasks";

const USER = "00000000-0000-4000-8000-0000000000aa";
const OTHER_USER = "00000000-0000-4000-8000-0000000000bb";
const NOW = new Date("2026-10-12T15:00:00Z");
const LAST_MONTH = new Date("2026-09-03T08:30:00Z");

const ACTIVE = "00000000-0000-4000-8000-000000000001";
const DONE = "00000000-0000-4000-8000-000000000002";
const ROUTINE_DONE = "00000000-0000-4000-8000-000000000003";
const ROUTINE_MISSED = "00000000-0000-4000-8000-000000000004";
const FOREIGN = "00000000-0000-4000-8000-000000000005";
const UNKNOWN = "00000000-0000-4000-8000-000000000006";

function row(id: string, fields: Partial<Row>): Row {
  return {
    id,
    userId: USER,
    projectId: "00000000-0000-4000-8000-0000000000cc",
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
    createdAt: new Date("2026-08-01T00:00:00Z"),
    ...fields,
  };
}

const stored = (id: string) => db.tasks.find((t) => t.id === id);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  const routineId = "00000000-0000-4000-8000-0000000000dd";
  db.tasks.splice(
    0,
    db.tasks.length,
    row(ACTIVE, {}),
    row(DONE, { status: "completed", completedAt: LAST_MONTH }),
    row(ROUTINE_DONE, {
      routineId,
      dueDate: new Date("2026-09-03T00:00:00Z"),
      status: "completed",
      completedAt: LAST_MONTH,
    }),
    row(ROUTINE_MISSED, {
      routineId,
      dueDate: new Date("2026-09-04T00:00:00Z"),
      status: "missed",
    }),
    row(FOREIGN, { userId: OTHER_USER }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("setTaskStatus completing", () => {
  it("stamps an active task with the present", async () => {
    const task = await setTaskStatus(USER, ACTIVE, "completed");
    expect(task?.status).toBe("completed");
    expect(task?.completedAt).toBe(NOW.toISOString());
    expect(stored(ACTIVE)?.completedAt).toEqual(NOW);
  });

  it.each([
    ["an ordinary task", DONE],
    ["a routine day", ROUTINE_DONE],
  ])("leaves %s that is already completed on its first completion", async (_, id) => {
    const task = await setTaskStatus(USER, id, "completed");
    expect(task?.status).toBe("completed");
    expect(task?.completedAt).toBe(LAST_MONTH.toISOString());
    expect(stored(id)?.completedAt).toEqual(LAST_MONTH);
  });

  it("refuses a missed routine day and leaves it missed", async () => {
    await expect(
      setTaskStatus(USER, ROUTINE_MISSED, "completed"),
    ).rejects.toThrow("Missed routine days can't be completed");
    expect(stored(ROUTINE_MISSED)).toMatchObject({
      status: "missed",
      completedAt: null,
    });
  });
});

describe("bulkComplete", () => {
  it("completes only active rows and reports a missed day as skipped", async () => {
    const result = await bulkComplete(USER, [
      ACTIVE,
      DONE,
      ROUTINE_DONE,
      ROUTINE_MISSED,
      FOREIGN,
      UNKNOWN,
    ]);

    expect(result.applied).toEqual([ACTIVE, DONE, ROUTINE_DONE]);
    expect(result.skipped).toEqual([
      { id: FOREIGN, reason: "not_found" },
      { id: UNKNOWN, reason: "not_found" },
      { id: ROUTINE_MISSED, reason: "routine_day_missed" },
    ]);
    expect(result.tasksChanged).toBe(true);

    expect(stored(ACTIVE)).toMatchObject({ status: "completed", completedAt: NOW });
    expect(stored(DONE)?.completedAt).toEqual(LAST_MONTH);
    expect(stored(ROUTINE_DONE)?.completedAt).toEqual(LAST_MONTH);
    expect(stored(ROUTINE_MISSED)).toMatchObject({
      status: "missed",
      completedAt: null,
    });
    expect(stored(FOREIGN)?.status).toBe("active");
  });

  it("reports no change when every row was already completed", async () => {
    const result = await bulkComplete(USER, [DONE, ROUTINE_DONE]);
    expect(result).toEqual({
      applied: [DONE, ROUTINE_DONE],
      skipped: [],
      tasksChanged: false,
    });
  });
});

/** Calls one MCP tool as an authenticated client with write scope. */
async function callTool(name: string, args: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "0" });
  registerTools(server);
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  await server.connect(serverEnd);

  const authInfo = {
    token: "test",
    clientId: "test",
    scopes: ["tasks:write"],
    extra: { userId: USER },
  };
  const pending = new Map<number, (m: JSONRPCMessage) => void>();
  clientEnd.onmessage = (m) => {
    if ("id" in m && typeof m.id === "number") pending.get(m.id)?.(m);
  };
  await clientEnd.start();
  const call = (id: number, method: string, params: unknown) =>
    new Promise<JSONRPCMessage>((resolve) => {
      pending.set(id, resolve);
      void clientEnd.send(
        { jsonrpc: "2.0", id, method, params } as JSONRPCMessage,
        { authInfo },
      );
    });

  await call(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  });
  await clientEnd.send(
    { jsonrpc: "2.0", method: "notifications/initialized" } as JSONRPCMessage,
    { authInfo },
  );
  const res = (await call(2, "tools/call", {
    name,
    arguments: args,
  })) as unknown as {
    result: { isError?: boolean; content: { type: string; text: string }[] };
  };
  await server.close();
  return res.result;
}

describe("MCP completion tools", () => {
  it("complete_task tells the model a missed routine day can't be completed", async () => {
    const result = await callTool("complete_task", { id: ROUTINE_MISSED });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      "Missed routine days can't be completed",
    );
  });

  it("complete_task returns an already-completed task with its first completion", async () => {
    const result = await callTool("complete_task", { id: ROUTINE_DONE });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      id: ROUTINE_DONE,
      status: "completed",
      completedAt: LAST_MONTH.toISOString(),
    });
  });

  it("bulk_complete skips a missed routine day", async () => {
    const result = await callTool("bulk_complete", {
      ids: [ACTIVE, ROUTINE_MISSED],
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toEqual({
      applied: [ACTIVE],
      skipped: [{ id: ROUTINE_MISSED, reason: "routine_day_missed" }],
      tasksChanged: true,
    });
  });
});

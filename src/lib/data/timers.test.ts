import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The slice of Prisma the timers module touches, faked in memory so each test
 * asserts the rows left behind. `timeEntry.create` enforces the
 * one-running-per-user index the migration adds. The hooks let a test play a
 * competing request: `onCreate` runs just before an insert, `afterRead` just
 * after the open entry has been read.
 */
const db = vi.hoisted(() => {
  type Row = Record<string, unknown> & { id: string };
  const tasks: Row[] = [];
  const entries: Row[] = [];
  const hooks: { onCreate: (() => void) | null; afterRead: (() => void) | null } = {
    onCreate: null,
    afterRead: null,
  };
  let seq = 0;

  const same = (a: unknown, b: unknown) =>
    a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

  function matches(row: Row, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (v !== null && typeof v === "object" && !(v instanceof Date)) {
        const c = v as { in?: unknown[] };
        if (!c.in) throw new Error(`fake prisma: unsupported filter on ${k}`);
        return c.in.includes(row[k]);
      }
      return same(row[k] ?? null, v);
    });
  }

  function remove(rows: Row[], hit: Row) {
    rows.splice(rows.indexOf(hit), 1);
  }

  const tx = {
    task: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const hit = tasks.find((t) => matches(t, where));
        return hit ? { ...hit } : null;
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const hit = tasks.find((t) => t.id === where.id);
        if (!hit) throw new Error("fake prisma: no task");
        return { ...hit };
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const hit = tasks.find((t) => t.id === where.id)!;
        Object.assign(hit, data);
        return { ...hit };
      },
    },
    timeEntry: {
      findFirst: async ({
        where,
        select,
      }: {
        where: Record<string, unknown>;
        select?: Record<string, unknown>;
      }) => {
        const hit = entries.find((e) => matches(e, where));
        const copy = hit && { ...hit };
        hooks.afterRead?.();
        hooks.afterRead = null;
        if (!hit) return null;
        if (select?.task) {
          return { ...hit, task: { ...tasks.find((t) => t.id === hit.taskId)! } };
        }
        return copy;
      },
      create: async ({ data }: { data: Row }) => {
        hooks.onCreate?.();
        hooks.onCreate = null;
        if (entries.some((e) => e.userId === data.userId && e.endedAt == null)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        const row = { endedAt: null, ...data, id: `entry-${++seq}` };
        entries.push(row);
        return { ...row };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<Row>;
      }) => {
        const hits = entries.filter((e) => matches(e, where));
        for (const h of hits) Object.assign(h, data);
        return { count: hits.length };
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const hits = entries.filter((e) => matches(e, where));
        for (const h of hits) remove(entries, h);
        return { count: hits.length };
      },
    },
  };

  // Writes apply in place, so a thrown transaction is not rolled back. The
  // only throw a test relies on, the unique violation, happens before any
  // write in its attempt.
  const prisma = {
    ...tx,
    $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };

  return { tasks, entries, hooks, prisma };
});

vi.mock("@/lib/db", () => ({ prisma: db.prisma }));

import {
  discardTimer,
  getRunningTimer,
  startTimer,
  stopTimer,
  stopTimerOnTasks,
} from "./timers";

const USER = "user-a";
const OTHER_USER = "user-b";
const NOW = new Date("2026-11-01T18:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function task(id: string, fields: Record<string, unknown> = {}) {
  return {
    id,
    userId: USER,
    content: id,
    status: "active",
    routineId: null,
    estimate: null,
    timeUsed: null,
    ...fields,
  };
}

function running(taskId: string, startedAt: Date, userId = USER) {
  db.entries.push({ id: `seed-${taskId}`, userId, taskId, startedAt, endedAt: null });
}

const timeUsed = (id: string) => db.tasks.find((t) => t.id === id)?.timeUsed;
const openEntries = (userId = USER) =>
  db.entries.filter((e) => e.userId === userId && e.endedAt == null);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  db.hooks.onCreate = null;
  db.hooks.afterRead = null;
  db.entries.splice(0);
  db.tasks.splice(
    0,
    db.tasks.length,
    task("a", { timeUsed: 20, estimate: 30 }),
    task("b"),
    task("done", { status: "completed" }),
    task("routine-day", { routineId: "r1" }),
    task("foreign", { userId: OTHER_USER }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startTimer", () => {
  it("opens an entry stamped with the server's now", async () => {
    expect(await startTimer(USER, "b")).toBeNull();
    expect(openEntries()).toEqual([
      expect.objectContaining({ taskId: "b", startedAt: NOW }),
    ]);
  });

  it("stops the running task first and records its session", async () => {
    running("a", minutesAgo(12));
    expect(await startTimer(USER, "b")).toBe("a");
    expect(timeUsed("a")).toBe(32);
    expect(openEntries().map((e) => e.taskId)).toEqual(["b"]);
  });

  it("leaves the running session alone when its own task is started again", async () => {
    running("a", minutesAgo(12));
    expect(await startTimer(USER, "a")).toBeNull();
    expect(openEntries()).toEqual([
      expect.objectContaining({ taskId: "a", startedAt: minutesAgo(12) }),
    ]);
    expect(timeUsed("a")).toBe(20);
  });

  it.each([
    ["a completed task", "done", "Only open tasks can be timed"],
    ["a routine day", "routine-day", "Routine days can't be timed"],
    ["another user's task", "foreign", "Task not found"],
  ])("refuses %s", async (_, id, message) => {
    await expect(startTimer(USER, id)).rejects.toThrow(message);
    expect(openEntries()).toEqual([]);
  });

  it("takes over when a competing start lands first", async () => {
    db.hooks.onCreate = () => running("a", NOW);
    await startTimer(USER, "b");
    expect(openEntries().map((e) => e.taskId)).toEqual(["b"]);
  });

  it("doesn't see another user's running timer", async () => {
    running("foreign", minutesAgo(5), OTHER_USER);
    await startTimer(USER, "b");
    expect(openEntries(OTHER_USER)).toHaveLength(1);
    expect(openEntries()).toHaveLength(1);
  });
});

describe("stopTimer", () => {
  it("adds the session to timeUsed and closes the entry", async () => {
    running("a", minutesAgo(12));
    expect(await stopTimer(USER)).toBe("a");
    expect(timeUsed("a")).toBe(32);
    expect(db.entries).toEqual([expect.objectContaining({ endedAt: NOW })]);
  });

  it("starts timeUsed from zero on an untimed task", async () => {
    running("b", minutesAgo(45));
    await stopTimer(USER);
    expect(timeUsed("b")).toBe(45);
  });

  it("discards a session under a minute, leaving timeUsed null", async () => {
    running("b", new Date(NOW.getTime() - 20_000));
    expect(await stopTimer(USER)).toBe("b");
    expect(timeUsed("b")).toBeNull();
    expect(db.entries).toEqual([]);
  });

  it("clamps timeUsed to its bound", async () => {
    db.tasks.find((t) => t.id === "a")!.timeUsed = 5990;
    running("a", minutesAgo(30));
    await stopTimer(USER);
    expect(timeUsed("a")).toBe(5999);
  });

  it("records up to a corrected stop time", async () => {
    running("a", minutesAgo(600));
    await stopTimer(USER, minutesAgo(560));
    expect(timeUsed("a")).toBe(60);
  });

  it.each([
    ["in the future", new Date(NOW.getTime() + 60_000), "Stop time can't be in the future"],
    ["before the start", minutesAgo(20), "Stop time is before the timer started"],
  ])("refuses a stop time %s", async (_, at, message) => {
    running("a", minutesAgo(12));
    await expect(stopTimer(USER, at)).rejects.toThrow(message);
    expect(openEntries()).toHaveLength(1);
    expect(timeUsed("a")).toBe(20);
  });

  it("is a no-op when nothing runs", async () => {
    expect(await stopTimer(USER)).toBeNull();
  });

  it("doesn't count a session another request closed after it was read", async () => {
    running("a", minutesAgo(12));
    db.hooks.afterRead = () => {
      db.entries[0].endedAt = NOW;
      db.tasks.find((t) => t.id === "a")!.timeUsed = 32;
    };
    await stopTimer(USER);
    expect(timeUsed("a")).toBe(32);
  });

  it("doesn't fail on a sub-minute session another request already dropped", async () => {
    running("a", new Date(NOW.getTime() - 20_000));
    db.hooks.afterRead = () => db.entries.splice(0);
    await expect(stopTimer(USER)).resolves.toBe("a");
  });
});

describe("discardTimer", () => {
  it("drops the session without touching timeUsed", async () => {
    running("a", minutesAgo(90));
    expect(await discardTimer(USER)).toBe("a");
    expect(db.entries).toEqual([]);
    expect(timeUsed("a")).toBe(20);
  });
});

describe("getRunningTimer", () => {
  it("returns the running task with its start", async () => {
    running("a", minutesAgo(12));
    expect(await getRunningTimer(USER)).toEqual({
      taskId: "a",
      content: "a",
      estimate: 30,
      timeUsed: 20,
      startedAt: minutesAgo(12).toISOString(),
    });
  });

  it("is null when nothing runs", async () => {
    expect(await getRunningTimer(USER)).toBeNull();
  });
});

describe("stopTimerOnTasks", () => {
  it("stops the timer when it runs on one of the tasks", async () => {
    running("a", minutesAgo(12));
    await stopTimerOnTasks(USER, ["b", "a"]);
    expect(openEntries()).toEqual([]);
    expect(timeUsed("a")).toBe(32);
  });

  it("leaves a timer on any other task running", async () => {
    running("a", minutesAgo(12));
    await stopTimerOnTasks(USER, ["b"]);
    expect(openEntries()).toHaveLength(1);
    expect(timeUsed("a")).toBe(20);
  });
});

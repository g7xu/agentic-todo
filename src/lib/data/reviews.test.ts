import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The slice of Prisma the reviews module touches, faked in memory so each
 * test asserts the rows left behind. Selects are ignored except for the
 * nested `notes` / `review` relations the module reads.
 */
const db = vi.hoisted(() => {
  type Row = Record<string, unknown> & { id: string };
  const reviews: Row[] = [];
  const notes: Row[] = [];
  const tasks: Row[] = [];
  const projects: Row[] = [];
  let seq = 0;
  const newId = (p: string) => `${p}-${++seq}`;

  const same = (a: unknown, b: unknown) =>
    a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

  function matches(row: Row, where: Record<string, unknown> = {}): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (k === "userId_weekStart") return matches(row, v as Record<string, unknown>);
      const val = row[k];
      if (v !== null && typeof v === "object" && !(v instanceof Date)) {
        const c = v as Record<string, unknown>;
        if ("in" in c) return (c.in as unknown[]).includes(val);
        if ("not" in c) return !same(val, c.not);
        const t = (val as Date | null)?.getTime();
        if (t === undefined) return false;
        if (c.gte && t < (c.gte as Date).getTime()) return false;
        if (c.lt && t >= (c.lt as Date).getTime()) return false;
        return true;
      }
      return same(val, v);
    });
  }

  const byOrder = (a: Row, b: Row) => (a.order as number) - (b.order as number);

  function shapeReview(r: Row, select?: Record<string, unknown>) {
    const out: Row = { ...r };
    const ns = select?.notes as { where?: Record<string, unknown> } | undefined;
    if (ns) {
      out.notes = notes
        .filter((n) => n.reviewId === r.id && matches(n, ns.where))
        .sort(byOrder)
        .map((n) => ({ ...n }));
    }
    return out;
  }

  const unique = (where: Record<string, unknown>) => reviews.find((r) => matches(r, where));

  const tx = {
    review: {
      findUnique: async (a: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
        const r = unique(a.where);
        return r ? shapeReview(r, a.select) : null;
      },
      findUniqueOrThrow: async (a: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
        const r = unique(a.where);
        if (!r) throw new Error("fake prisma: review not found");
        return shapeReview(r, a.select);
      },
      findMany: async (a: { where: Record<string, unknown>; select?: Record<string, unknown> }) =>
        reviews
          .filter((r) => matches(r, a.where))
          .sort((x, y) => (y.weekStart as Date).getTime() - (x.weekStart as Date).getTime())
          .map((r) => shapeReview(r, a.select)),
      create: async ({ data }: { data: Row }) => {
        if (reviews.some((r) => r.userId === data.userId && same(r.weekStart, data.weekStart))) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        const row = { closedAt: null, createdAt: new Date(), ...data, id: newId("review") };
        reviews.push(row);
        return { ...row };
      },
      update: async ({ where, data }: { where: Record<string, unknown>; data: Row }) => {
        const r = unique(where)!;
        Object.assign(r, data);
        return { ...r };
      },
    },
    reviewNote: {
      aggregate: async ({ where }: { where: Record<string, unknown> }) => {
        const hits = notes.filter((n) => matches(n, where));
        return { _max: { order: hits.length ? Math.max(...hits.map((n) => n.order as number)) : null } };
      },
      create: async ({ data }: { data: Row }) => {
        const row = { carriedTaskId: null, createdAt: new Date(), ...data, id: newId("note") };
        notes.push(row);
        return { ...row };
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const n = notes.find((x) => matches(x, where));
        if (!n) return null;
        return { ...n, review: reviews.find((r) => r.id === n.reviewId) };
      },
      update: async ({ where, data }: { where: Record<string, unknown>; data: Row }) => {
        const n = notes.find((x) => matches(x, where))!;
        Object.assign(n, data);
        return { ...n };
      },
      delete: async ({ where }: { where: Record<string, unknown> }) => {
        notes.splice(notes.findIndex((x) => matches(x, where)), 1);
      },
    },
    task: {
      aggregate: async ({ where }: { where: Record<string, unknown> }) => {
        const hits = tasks.filter((t) => matches(t, where));
        return { _max: { order: hits.length ? Math.max(...hits.map((t) => t.order as number)) : null } };
      },
      create: async ({ data }: { data: Row }) => {
        const row = { status: "active", ...data, id: newId("task") };
        tasks.push(row);
        return { ...row };
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        tasks.filter((t) => matches(t, where)).map((t) => ({ ...t })),
    },
    project: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        projects.find((p) => matches(p, where)) ?? null,
    },
  };
  const prisma = {
    ...tx,
    $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  const reset = () => {
    for (const a of [reviews, notes, tasks, projects]) a.length = 0;
    seq = 0;
  };
  return { reviews, notes, tasks, projects, prisma, reset };
});

vi.mock("@/lib/db", () => ({ prisma: db.prisma }));

import {
  REVIEW_CLOSED,
  addNote,
  closeReview,
  deleteNote,
  getReview,
  listCompletedBetween,
  listReviews,
  moveNote,
} from "./reviews";

const USER = "user-a";
const OTHER = "user-b";
const INBOX = "inbox-a";
const WEEK = "2026-10-25"; // a Sunday

beforeEach(() => {
  db.reset();
  db.projects.push({ id: INBOX, userId: USER, isInbox: true });
  db.tasks.push({ id: "old", userId: USER, projectId: INBOX, order: 4, status: "active" });
});

describe("addNote", () => {
  it("creates the week's review with its first note, and only once", async () => {
    expect(await getReview(USER, WEEK)).toBeNull();
    await addNote(USER, WEEK, { kind: "rose", content: "Shipped MCP" });
    await addNote(USER, WEEK, { kind: "rose", content: "Kept Building" });
    await addNote(USER, WEEK, { kind: "thorn", content: "Skipped gym" });

    expect(db.reviews).toHaveLength(1);
    const review = await getReview(USER, WEEK);
    expect(review?.weekStart).toBe(WEEK);
    const roses = review!.notes.filter((n) => n.kind === "rose");
    expect(roses.map((n) => n.order), "appends within its column").toEqual([1, 2]);
  });

  it("refuses a note on a closed week", async () => {
    await addNote(USER, WEEK, { kind: "seed", content: "Try Inngest" });
    await closeReview(USER, WEEK, []);
    await expect(
      addNote(USER, WEEK, { kind: "seed", content: "Late idea" }),
    ).rejects.toThrow(REVIEW_CLOSED);
  });
});

describe("editing notes", () => {
  it("moves a note between columns", async () => {
    const n = await addNote(USER, WEEK, { kind: "seed", content: "Call mom" });
    await moveNote(USER, n.id, { kind: "action", order: 0.5 });
    expect(db.notes[0]).toMatchObject({ kind: "action", order: 0.5 });
  });

  it("does not let another user touch a note", async () => {
    const n = await addNote(USER, WEEK, { kind: "seed", content: "Mine" });
    await expect(deleteNote(OTHER, n.id)).rejects.toThrow("Note not found");
    expect(db.notes).toHaveLength(1);
  });
});

describe("closeReview", () => {
  it("turns the chosen actions into Inbox tasks for next Sunday and closes the week", async () => {
    const a = await addNote(USER, WEEK, { kind: "action", content: "Apply to 5 jobs" });
    const b = await addNote(USER, WEEK, { kind: "action", content: "Book dentist" });
    await addNote(USER, WEEK, { kind: "action", content: "Not chosen" });

    const closed = await closeReview(USER, WEEK, [a.id, b.id]);

    expect(closed.closedAt).not.toBeNull();
    const created = db.tasks.filter((t) => t.id !== "old");
    expect(created.map((t) => t.content)).toEqual(["Apply to 5 jobs", "Book dentist"]);
    for (const t of created) {
      expect(t).toMatchObject({ userId: USER, projectId: INBOX });
      expect((t.dueDate as Date).toISOString().slice(0, 10)).toBe("2026-11-01");
    }
    expect(created.map((t) => t.order), "appended after the Inbox's last task").toEqual([5, 6]);
    const carried = closed.notes.filter((n) => n.carriedTaskId);
    expect(carried.map((n) => n.carriedTaskId)).toEqual(created.map((t) => t.id));
  });

  it("refuses more than three actions", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push((await addNote(USER, WEEK, { kind: "action", content: `a${i}` })).id);
    }
    await expect(closeReview(USER, WEEK, ids)).rejects.toThrow("At most 3");
    expect(db.reviews[0].closedAt).toBeNull();
  });

  it("refuses notes that are not this week's actions", async () => {
    const thorn = await addNote(USER, WEEK, { kind: "thorn", content: "Bad sleep" });
    const otherWeek = await addNote(USER, "2026-10-18", { kind: "action", content: "Old" });
    await expect(closeReview(USER, WEEK, [thorn.id])).rejects.toThrow("action notes");
    await expect(closeReview(USER, WEEK, [otherWeek.id])).rejects.toThrow("action notes");
    expect(db.tasks).toHaveLength(1);
  });
});

describe("listReviews", () => {
  it("counts notes per column, newest week first", async () => {
    await addNote(USER, "2026-10-18", { kind: "thorn", content: "x" });
    await addNote(USER, WEEK, { kind: "rose", content: "y" });
    await addNote(USER, WEEK, { kind: "rose", content: "z" });
    await addNote(OTHER, WEEK, { kind: "seed", content: "theirs" });

    const list = await listReviews(USER);
    expect(list.map((r) => r.weekStart)).toEqual([WEEK, "2026-10-18"]);
    expect(list[0].counts).toEqual({ thorn: 0, rose: 2, seed: 0, action: 0 });
  });
});

describe("listCompletedBetween", () => {
  it("places a completion on the user's local day, and skips routine days", async () => {
    const done = (id: string, at: string, routineId: string | null = null) =>
      db.tasks.push({
        id,
        userId: USER,
        projectId: INBOX,
        content: id,
        status: "completed",
        routineId,
        completedAt: new Date(at),
        createdAt: new Date(at),
        order: 0,
        dueDate: null,
        deadline: null,
      });
    // 2026-11-01 05:30 UTC is still Saturday Oct 31 in Los Angeles: inside the week.
    done("saturday-night", "2026-11-01T05:30:00Z");
    // 2026-10-25 06:30 UTC is Saturday Oct 24 in LA: the week before.
    done("previous-week", "2026-10-25T06:30:00Z");
    done("routine-day", "2026-10-27T18:00:00Z", "routine-1");
    done("tuesday", "2026-10-27T18:00:00Z");

    const rows = await listCompletedBetween(USER, WEEK, "2026-10-31", "America/Los_Angeles");
    expect(rows.map((r) => r.id).sort()).toEqual(["saturday-night", "tuesday"]);
  });
});

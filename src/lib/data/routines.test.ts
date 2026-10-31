import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The slice of Prisma `updateRoutine` touches, faked in memory so the test
 * asserts the rows left behind. Only the calls that path makes are
 * implemented; anything else is undefined and would throw.
 */
const db = vi.hoisted(() => {
  type Routine = Record<string, unknown> & { id: string; userId: string };
  type Task = {
    id: string;
    userId: string;
    routineId: string | null;
    projectId: string;
  };
  const routines: Routine[] = [];
  const tasks: Task[] = [];
  const projects: { id: string; userId: string }[] = [];

  const eq = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => row[k] === v);

  const tx = {
    routine: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        routines.find((r) => eq(r, where)) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const hit = routines.find((r) => eq(r, where));
        if (!hit) throw new Error("fake prisma: routine not found");
        Object.assign(hit, data);
        return { ...hit };
      },
    },
    task: {
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<Task>;
      }) => {
        const hits = tasks.filter((t) => eq(t, where));
        for (const t of hits) Object.assign(t, data);
        return { count: hits.length };
      },
    },
    project: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        projects.find((p) => eq(p, where)) ?? null,
    },
    profile: {
      findUnique: async () => ({ timezone: "UTC" }),
    },
  };
  const prisma = {
    ...tx,
    $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return { routines, tasks, projects, prisma };
});

vi.mock("@/lib/db", () => ({ prisma: db.prisma }));

import { updateRoutine } from "./routines";

const USER = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000bb";
const ROUTINE = "00000000-0000-4000-8000-0000000000dd";
const OLD_PROJECT = "00000000-0000-4000-8000-000000000011";
const NEW_PROJECT = "00000000-0000-4000-8000-000000000022";

beforeEach(() => {
  db.routines.splice(0, db.routines.length, {
    id: ROUTINE,
    userId: USER,
    content: "Job application",
    description: null,
    priority: 1,
    estimate: 30,
    projectId: OLD_PROJECT,
    repeatEvery: 1,
    repeatUnit: "day",
    repeatWeekdays: [],
    repeatBase: "scheduled",
    startDate: new Date("2026-07-17T00:00:00Z"),
    endDate: null,
    active: true,
    createdAt: new Date("2026-07-17T00:00:00Z"),
  });
  db.projects.splice(0, db.projects.length, { id: NEW_PROJECT, userId: USER });
  db.tasks.splice(
    0,
    db.tasks.length,
    { id: "day-1", userId: USER, routineId: ROUTINE, projectId: OLD_PROJECT },
    { id: "day-2", userId: USER, routineId: ROUTINE, projectId: OLD_PROJECT },
    { id: "one-off", userId: USER, routineId: null, projectId: OLD_PROJECT },
    { id: "foreign", userId: OTHER, routineId: ROUTINE, projectId: OLD_PROJECT },
  );
});

describe("updateRoutine", () => {
  it("moves the routine's recorded days with it when its project changes", async () => {
    await updateRoutine(USER, ROUTINE, { projectId: NEW_PROJECT });

    const by = (id: string) => db.tasks.find((t) => t.id === id)!.projectId;
    expect(by("day-1")).toBe(NEW_PROJECT);
    expect(by("day-2")).toBe(NEW_PROJECT);
    expect(by("one-off"), "an ordinary task in the old project").toBe(
      OLD_PROJECT,
    );
    expect(by("foreign"), "another user's row").toBe(OLD_PROJECT);
  });

  it("leaves recorded days alone when the edit does not touch the project", async () => {
    await updateRoutine(USER, ROUTINE, { content: "Applications" });
    expect(db.tasks.every((t) => t.projectId === OLD_PROJECT)).toBe(true);
  });
});

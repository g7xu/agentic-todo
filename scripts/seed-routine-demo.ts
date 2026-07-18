/**
 * Seed a set of routine scenarios for manual testing (docs/ROUTINES.md §RV5-RV9).
 *
 *   npm run demo:seed     create everything
 *   npm run demo:clean    remove everything it created
 *
 * Everything lives in one project, "Routine demo", so cleanup is exact: the
 * clean pass deletes that project's tasks and routines and nothing else. Your
 * real data is never read or written.
 *
 * Occurrences come from `occurrencesBetween`, the same function the spawner and
 * the Activity grid use, so the seeded history cannot disagree with what the
 * app believes the cadence to be. A seeded 'missed' row keeps its own date, as
 * a real one would (§RV7).
 */
import { readFileSync } from "node:fs";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@/generated/prisma/client";
import { addDays, toDbDate, todayStr } from "@/lib/date";
import { occurrencesBetween } from "@/lib/repeat";
import type { RoutineRepeatBase, RoutineRepeatUnit } from "@/lib/types";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m) process.env[m[1]] ??= m[2];
}

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const PROJECT = "Routine demo";
const WINDOW = 84;

/** Deterministic, so re-seeding produces the same grid and a bug is
 * reproducible rather than a different shape every run. */
let seed = 20260718;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/** 'skip' writes no row at all — the day the app was never opened, which is
 * what produces a 'no record' cell (§RV8) and what backfill later fills. */
type Outcome = "done" | "missed" | "skip";

type Scenario = {
  content: string;
  note: string;
  repeatUnit: RoutineRepeatUnit;
  repeatEvery: number;
  repeatWeekdays: number[];
  repeatBase: RoutineRepeatBase;
  /** Days before today the routine started. */
  startedDaysAgo: number;
  endedDaysAgo?: number;
  active?: boolean;
  /** Decides each due day. `ago` is days before today, so 0 is today. */
  outcome: (ago: number) => Outcome;
  /** Leave an unfinished catch-up task outstanding (§RV7). */
  catchUp?: boolean;
  /** Complete an occurrence this many days AHEAD of today (§RV6). */
  completeAhead?: number;
};

const SCENARIOS: Scenario[] = [
  {
    content: "Stretch",
    note: "near-perfect daily streak — 100% and a long run",
    repeatUnit: "day",
    repeatEvery: 1,
    repeatWeekdays: [],
    repeatBase: "scheduled",
    startedDaysAgo: 80,
    outcome: (ago) => (ago > 60 && rnd() < 0.2 ? "missed" : "done"),
  },
  {
    content: "Read 20 pages",
    note: "a 9-day hole where the app was never opened — 'no record' cells",
    repeatUnit: "day",
    repeatEvery: 1,
    repeatWeekdays: [],
    repeatBase: "scheduled",
    startedDaysAgo: 80,
    outcome: (ago) =>
      ago >= 20 && ago <= 28 ? "skip" : rnd() < 0.7 ? "done" : "missed",
  },
  {
    content: "Floss",
    note: "chronic misser — low rate, broken streak",
    repeatUnit: "day",
    repeatEvery: 1,
    repeatWeekdays: [],
    repeatBase: "scheduled",
    startedDaysAgo: 60,
    outcome: () => (rnd() < 0.35 ? "done" : "missed"),
  },
  {
    content: "Gym",
    note: "every weekday — weekends render 'not due'",
    repeatUnit: "weekday",
    repeatEvery: 1,
    repeatWeekdays: [],
    repeatBase: "scheduled",
    startedDaysAgo: 70,
    outcome: () => (rnd() < 0.75 ? "done" : "missed"),
  },
  {
    content: "Water plants",
    note: "weekly on Tue — sparse row, and an outstanding catch-up task",
    repeatUnit: "week",
    repeatEvery: 1,
    repeatWeekdays: [2],
    repeatBase: "scheduled",
    startedDaysAgo: 75,
    outcome: (ago) => (ago <= 7 ? "missed" : rnd() < 0.8 ? "done" : "missed"),
    catchUp: true,
  },
  {
    content: "Pay rent",
    note: "monthly — two or three cells in the whole window",
    repeatUnit: "month",
    repeatEvery: 1,
    repeatWeekdays: [],
    repeatBase: "scheduled",
    startedDaysAgo: 75,
    outcome: () => "done",
  },
  {
    content: "Deep clean",
    note: "completed-based — projects nothing, claims no streak",
    repeatUnit: "week",
    repeatEvery: 2,
    repeatWeekdays: [],
    repeatBase: "completed",
    startedDaysAgo: 70,
    outcome: () => (rnd() < 0.5 ? "done" : "skip"),
  },
  {
    content: "Morning pages",
    note: "PAUSED — history remains, nothing new spawns or backfills",
    repeatUnit: "day",
    repeatEvery: 1,
    repeatWeekdays: [],
    repeatBase: "scheduled",
    startedDaysAgo: 60,
    active: false,
    outcome: (ago) => (ago < 25 ? "skip" : rnd() < 0.6 ? "done" : "missed"),
  },
  {
    content: "Physio exercises",
    note: "ENDED 10 days ago — occurrences stop at endDate",
    repeatUnit: "day",
    repeatEvery: 1,
    repeatWeekdays: [],
    repeatBase: "scheduled",
    startedDaysAgo: 50,
    endedDaysAgo: 10,
    outcome: () => (rnd() < 0.8 ? "done" : "missed"),
  },
  {
    content: "Take vitamins",
    note: "one occurrence completed AHEAD of time — visible in Upcoming",
    repeatUnit: "day",
    repeatEvery: 1,
    repeatWeekdays: [],
    repeatBase: "scheduled",
    startedDaysAgo: 30,
    outcome: () => (rnd() < 0.85 ? "done" : "missed"),
    completeAhead: 2,
  },
];

async function resolveUser() {
  const p = await prisma.profile.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, timezone: true },
  });
  if (!p) throw new Error("no profile found — sign in to the app once first");
  return p;
}

async function clean(userId: string) {
  const project = await prisma.project.findFirst({
    where: { userId, name: PROJECT },
    select: { id: true },
  });
  if (!project) {
    console.log("nothing to clean");
    return;
  }
  const tasks = await prisma.task.deleteMany({
    where: { userId, projectId: project.id },
  });
  const routines = await prisma.routine.deleteMany({
    where: { userId, projectId: project.id },
  });
  await prisma.project.delete({ where: { id: project.id } });
  console.log(
    `cleaned: ${tasks.count} tasks, ${routines.count} routines, 1 project`,
  );
}

async function seedAll(userId: string, tz: string) {
  const today = todayStr(tz);
  const windowStart = addDays(today, -(WINDOW - 1));

  const project = await prisma.project.create({
    data: { userId, name: PROJECT, color: "#6257A6", order: 999 },
    select: { id: true },
  });

  let order = 0;
  let rows = 0;

  for (const s of SCENARIOS) {
    const startDate = addDays(today, -s.startedDaysAgo);
    const endDate = s.endedDaysAgo ? addDays(today, -s.endedDaysAgo) : null;

    const routine = await prisma.routine.create({
      data: {
        userId,
        projectId: project.id,
        content: s.content,
        description: s.note,
        priority: 4,
        repeatEvery: s.repeatEvery,
        repeatUnit: s.repeatUnit,
        repeatWeekdays: s.repeatWeekdays,
        repeatBase: s.repeatBase,
        startDate: toDbDate(startDate),
        endDate: endDate ? toDbDate(endDate) : null,
        active: s.active ?? true,
      },
      select: { id: true },
    });

    // Completed-based routines have no computable grid, so their history is
    // seeded on a plain 2-week rhythm instead — which is exactly why the grid
    // shows them only as recorded events (§RV8).
    const days =
      s.repeatBase === "completed"
        ? Array.from({ length: 6 }, (_, k) =>
            addDays(today, -(s.startedDaysAgo - k * 14)),
          ).filter((d) => d <= today && d >= windowStart)
        : occurrencesBetween(
            {
              repeatEvery: s.repeatEvery,
              repeatUnit: s.repeatUnit,
              repeatWeekdays: s.repeatWeekdays,
              repeatBase: "scheduled",
              startDate,
              endDate,
            },
            windowStart,
            today,
          );

    const data = [];
    for (const d of days) {
      const ago = Math.round(
        (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) /
          86_400_000,
      );
      // Today's occurrence stays live work, not history — that is what the
      // user sees in Today.
      if (ago === 0) {
        data.push({ status: "active", completedAt: null, dueDate: d });
        continue;
      }
      const o = s.outcome(ago);
      if (o === "skip") continue;
      data.push({
        status: o === "done" ? "completed" : "missed",
        completedAt: o === "done" ? new Date(`${d}T18:00:00.000Z`) : null,
        dueDate: d,
      });
    }

    if (s.completeAhead) {
      const d = addDays(today, s.completeAhead);
      data.push({
        status: "completed",
        completedAt: new Date(),
        dueDate: d,
      });
    }

    if (data.length > 0) {
      await prisma.task.createMany({
        data: data.map((x) => ({
          userId,
          projectId: project.id,
          routineId: routine.id,
          content: s.content,
          description: null,
          priority: 4,
          dueDate: toDbDate(x.dueDate),
          status: x.status,
          completedAt: x.completedAt,
          order: ++order,
        })),
        skipDuplicates: true,
      });
      rows += data.length;
    }

    if (s.catchUp) {
      // An ordinary task: routineId NULL so it is freely reschedulable,
      // fromRoutineId set so the one-outstanding guard sees it (§RV7).
      await prisma.task.create({
        data: {
          userId,
          projectId: project.id,
          fromRoutineId: routine.id,
          content: s.content,
          priority: 4,
          dueDate: toDbDate(addDays(today, -7)),
          status: "active",
          order: ++order,
        },
      });
      rows++;
    }

    console.log(`  ${s.content.padEnd(18)} ${s.note}`);
  }

  console.log(
    `\nseeded ${SCENARIOS.length} routines and ${rows} rows into "${PROJECT}"`,
  );
}

async function main() {
  const mode = process.argv[2] === "clean" ? "clean" : "seed";
  const user = await resolveUser();
  console.log(`${mode} for ${user.email} (${user.timezone})\n`);

  // Seeding always cleans first, so re-running converges instead of stacking
  // duplicate projects.
  await clean(user.id);
  if (mode === "seed") await seedAll(user.id, user.timezone);

  await prisma.$disconnect();
}
main();

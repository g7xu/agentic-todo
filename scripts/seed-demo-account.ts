/**
 * Fill a dedicated demo account with realistic data: the reviewer login for
 * the Claude connector directory, the footage for the demo video, and the
 * try-it account for launch posts.
 *
 *   npm run demo:account -- <email> --wipe
 *
 * The account must already exist: sign up in the app with that email first.
 * `--wipe` is required because the script deletes everything the account
 * holds (tasks, routines, every project but the Inbox) before seeding, so
 * that re-running it is a reset. The owner's own account is never touched:
 * the script refuses an email that does not contain "demo".
 *
 * Targets whichever database `.env.local` names; pass
 * `--env-file=.env.production.local` to tsx for the production account.
 */
import { readFileSync } from "node:fs";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@/generated/prisma/client";
import { addDays, toDbDate, todayStr } from "@/lib/date";
import { occurrencesBetween } from "@/lib/repeat";
import type { RoutineRepeatUnit } from "@/lib/types";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m) process.env[m[1]] ??= m[2];
}

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const HISTORY_DAYS = 42;

/** Deterministic, so every reset produces the same account. */
let seed = 20261008;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

type TaskSeed = {
  content: string;
  project: "Inbox" | "Work" | "Home";
  /** Days from today; undefined leaves the task undated. */
  due?: number;
  deadline?: number;
  priority?: number;
  estimate?: number;
  timeUsed?: number;
  description?: string;
  /** Days ago it was completed. */
  doneAgo?: number;
};

const TASKS: TaskSeed[] = [
  // Overdue, one past its deadline too
  { content: "Submit expense report", project: "Work", due: -3, deadline: -1, priority: 2, estimate: 20 },
  { content: "Return library books", project: "Home", due: -1 },
  // Today
  { content: "Review PR feedback on the onboarding flow", project: "Work", due: 0, deadline: 2, priority: 1, estimate: 45, description: "Design left 14 comments; the empty-state copy is the contentious one." },
  { content: "Renew passport", project: "Inbox", due: 0, deadline: 10, priority: 2, estimate: 30 },
  { content: "Buy groceries", project: "Home", due: 0, estimate: 40 },
  // Tomorrow and this week
  { content: "Write the launch post", project: "Work", due: 1, priority: 2, estimate: 120 },
  { content: "Book flights for the offsite", project: "Work", due: 1, deadline: 4, priority: 2 },
  { content: "Read the new RFC", project: "Work", due: 2, estimate: 30 },
  { content: "Water the plants", project: "Home", due: 2 },
  { content: "Call the dentist", project: "Home", due: 3, priority: 3 },
  { content: "Prepare 1:1 notes", project: "Work", due: 4, estimate: 15 },
  // Next week
  { content: "Quarterly planning draft", project: "Work", due: 8, deadline: 12, priority: 1, estimate: 180 },
  { content: "Replace bike tyre", project: "Home", due: 9 },
  // Undated
  { content: "Someday: learn Rust", project: "Inbox" },
  { content: "Ideas for the blog", project: "Inbox", description: "- why todo apps fail\n- planned date vs deadline" },
  // Completed over the last days, with time tracked
  { content: "Email the team about the retro", project: "Work", due: -1, estimate: 10, timeUsed: 15, doneAgo: 1 },
  { content: "Fix the flaky test", project: "Work", due: -2, estimate: 60, timeUsed: 140, doneAgo: 2 },
  { content: "Pick up dry cleaning", project: "Home", due: -4, doneAgo: 4 },
];

type RoutineSeed = {
  content: string;
  project: "Work" | "Home";
  repeatUnit: RoutineRepeatUnit;
  repeatWeekdays?: number[];
  priority?: number;
  estimate?: number;
  /** Chance a due day was completed. */
  rate: number;
};

const ROUTINES: RoutineSeed[] = [
  // The one the demo prompt asks about: good but not perfect.
  { content: "Daily review", project: "Work", repeatUnit: "day", priority: 2, estimate: 15, rate: 0.85 },
  { content: "Gym", project: "Home", repeatUnit: "weekday", estimate: 60, rate: 0.7 },
  { content: "Stretch", project: "Home", repeatUnit: "day", estimate: 10, rate: 0.95 },
  { content: "Water plants", project: "Home", repeatUnit: "week", repeatWeekdays: [2], rate: 0.8 },
  { content: "Inbox zero", project: "Work", repeatUnit: "week", repeatWeekdays: [5], estimate: 30, rate: 0.5 },
];

function parseArgs(): { email: string; wipe: boolean } {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith("--"));
  if (!email) throw new Error("usage: demo:account -- <email> --wipe");
  if (!email.toLowerCase().includes("demo")) {
    throw new Error(`refusing: "${email}" does not look like a demo account`);
  }
  return { email, wipe: args.includes("--wipe") };
}

async function wipe(userId: string): Promise<void> {
  const tasks = await prisma.task.deleteMany({ where: { userId } });
  const routines = await prisma.routine.deleteMany({ where: { userId } });
  const projects = await prisma.project.deleteMany({
    where: { userId, isInbox: false },
  });
  console.log(
    `wiped ${tasks.count} tasks, ${routines.count} routines, ${projects.count} projects`,
  );
}

async function seedAll(userId: string, tz: string): Promise<void> {
  const today = todayStr(tz);
  const inbox = await prisma.project.findFirst({
    where: { userId, isInbox: true },
    select: { id: true },
  });
  if (!inbox) throw new Error("no Inbox; open the app as this user once");
  const work = await prisma.project.create({
    data: { userId, name: "Work", order: 1 },
    select: { id: true },
  });
  const home = await prisma.project.create({
    data: { userId, name: "Home", order: 2 },
    select: { id: true },
  });
  const projectId = { Inbox: inbox.id, Work: work.id, Home: home.id };

  let order = 0;
  await prisma.task.createMany({
    data: TASKS.map((t) => ({
      userId,
      projectId: projectId[t.project],
      content: t.content,
      description: t.description ?? null,
      priority: t.priority ?? 4,
      dueDate: t.due === undefined ? null : toDbDate(addDays(today, t.due)),
      deadline: t.deadline === undefined ? null : toDbDate(addDays(today, t.deadline)),
      estimate: t.estimate ?? null,
      timeUsed: t.timeUsed ?? null,
      status: t.doneAgo === undefined ? "active" : "completed",
      completedAt:
        t.doneAgo === undefined
          ? null
          : new Date(`${addDays(today, -t.doneAgo)}T17:00:00.000Z`),
      order: ++order,
    })),
  });
  console.log(`seeded ${TASKS.length} tasks`);

  const windowStart = addDays(today, -(HISTORY_DAYS - 1));
  let rows = 0;
  for (const r of ROUTINES) {
    const startDate = addDays(today, -(HISTORY_DAYS + 7));
    const routine = await prisma.routine.create({
      data: {
        userId,
        projectId: projectId[r.project],
        content: r.content,
        priority: r.priority ?? 4,
        estimate: r.estimate ?? null,
        repeatEvery: 1,
        repeatUnit: r.repeatUnit,
        repeatWeekdays: r.repeatWeekdays ?? [],
        repeatBase: "scheduled",
        startDate: toDbDate(startDate),
      },
      select: { id: true },
    });
    const days = occurrencesBetween(
      {
        repeatEvery: 1,
        repeatUnit: r.repeatUnit,
        repeatWeekdays: r.repeatWeekdays ?? [],
        repeatBase: "scheduled",
        startDate,
        endDate: null,
      },
      windowStart,
      addDays(today, -1), // today stays open until the user ticks it
    );
    const data = days.map((d) => {
      const done = rnd() < r.rate;
      return {
        userId,
        projectId: projectId[r.project],
        routineId: routine.id,
        content: r.content,
        priority: r.priority ?? 4,
        estimate: r.estimate ?? null,
        dueDate: toDbDate(d),
        status: done ? "completed" : "missed",
        completedAt: done ? new Date(`${d}T18:00:00.000Z`) : null,
        order: ++order,
      };
    });
    if (data.length) await prisma.task.createMany({ data });
    rows += data.length;
  }
  console.log(`seeded ${ROUTINES.length} routines with ${rows} days of history`);
}

async function main() {
  const { email, wipe: confirmed } = parseArgs();
  const user = await prisma.profile.findFirst({
    where: { email },
    select: { id: true, email: true, timezone: true },
  });
  if (!user) throw new Error(`no account for ${email}; sign up in the app first`);
  if (!confirmed) {
    throw new Error("pass --wipe to confirm replacing everything in this account");
  }
  console.log(`resetting ${user.email} (${user.timezone})`);
  await wipe(user.id);
  await seedAll(user.id, user.timezone);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });

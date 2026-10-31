import { prisma } from "@/lib/db";
import { addDays, toDbDate } from "@/lib/date";
import { summarizeTimeByProject, type TimeShare } from "@/lib/time-share";

/**
 * Completed work in `from..to` (user-local days, inclusive) grouped by project.
 * Reads only: unlike `listTasks` this records nothing (docs/ROUTINES.md §RV8)
 * and has no row cap, since a year of completions is a few thousand narrow rows.
 *
 * The day a row counts on is decided in `summarizeTimeByProject`, after
 * conversion to the user's timezone. The query only has to be wide enough
 * never to miss one: a day's completions can be stamped up to 14 hours before
 * its UTC midnight (UTC+14) or 12 hours after the next (UTC−12), so one extra
 * calendar day on either side covers every timezone.
 */
export async function getTimeByProject(
  userId: string,
  from: string,
  to: string,
  tz: string,
): Promise<TimeShare> {
  const lower = toDbDate(addDays(from, -1));
  const upper = toDbDate(addDays(to, 2));
  const rows = await prisma.task.findMany({
    where: {
      userId,
      status: "completed",
      OR: [
        { completedAt: { gte: lower, lt: upper } },
        { routineId: { not: null }, dueDate: { gte: lower, lt: upper } },
      ],
    },
    select: {
      projectId: true,
      routineId: true,
      estimate: true,
      timeUsed: true,
      dueDate: true,
      completedAt: true,
    },
  });
  return summarizeTimeByProject(rows, from, to, tz);
}

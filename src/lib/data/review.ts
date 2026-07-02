import { prisma } from "@/lib/db";
import { dbDateToStr, toDbDate } from "@/lib/date";
import { listTasks } from "@/lib/data/tasks";
import type { TaskDTO } from "@/lib/types";

/** Incomplete tasks to review: active tasks due on/before today (overdue + today). */
export async function gatherIncomplete(
  userId: string,
  today: string,
): Promise<TaskDTO[]> {
  const all = await listTasks(userId);
  return all
    .filter(
      (t) => t.status === "active" && t.dueDate !== null && t.dueDate <= today,
    )
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
}

export type ApplyItem = { taskId: string; fromDate: string; toDate: string };

export type ReviewApplyResult = {
  applied: { taskId: string; toDate: string }[];
  skipped: { taskId: string; reason: string }[];
  tasksChanged: boolean;
};

/**
 * Apply the (possibly edited) review plan in a single transaction (TDD §6.3).
 * Each item is re-validated against current state; an item is skipped (not
 * errored) when the task was completed/deleted, moved out from under the plan
 * (current due_date ≠ fromDate), or its target is in the past (today re-derived
 * by the caller). Applied items commit together; a real error rolls back all.
 */
export async function applyReviewPlan(
  userId: string,
  today: string,
  items: ApplyItem[],
): Promise<ReviewApplyResult> {
  return prisma.$transaction(async (tx) => {
    const applied: { taskId: string; toDate: string }[] = [];
    const skipped: { taskId: string; reason: string }[] = [];

    for (const item of items) {
      const t = await tx.task.findFirst({
        where: { id: item.taskId, userId },
        select: { id: true, status: true, dueDate: true },
      });
      if (!t) {
        skipped.push({ taskId: item.taskId, reason: "not_found" });
        continue;
      }
      if (t.status === "completed") {
        skipped.push({ taskId: item.taskId, reason: "completed" });
        continue;
      }
      if (dbDateToStr(t.dueDate) !== item.fromDate) {
        skipped.push({ taskId: item.taskId, reason: "moved" });
        continue;
      }
      if (item.toDate < today) {
        skipped.push({ taskId: item.taskId, reason: "past_date" });
        continue;
      }
      await tx.task.update({
        where: { id: item.taskId },
        data: { dueDate: toDbDate(item.toDate) },
      });
      applied.push({ taskId: item.taskId, toDate: item.toDate });
    }

    return { applied, skipped, tasksChanged: applied.length > 0 };
  });
}

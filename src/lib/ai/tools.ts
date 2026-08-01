import { tool } from "ai";
import { z } from "zod";
import { addDays } from "@/lib/date";
import {
  bulkComplete,
  bulkDelete,
  bulkReschedule,
  createTask,
  deleteTask,
  listTasks,
  setTaskStatus,
  updateTask,
} from "@/lib/data/tasks";
import { listProjects } from "@/lib/data/projects";
import type { TaskDTO } from "@/lib/types";

export type ToolContext = {
  userId: string;
  tz: string;
  today: string;
  inboxId: string;
};

/**
 * Per-turn fan-out guard (TDD §6.1). Tracks single-id mutating tool calls keyed
 * by operation; once the same operation is attempted on a 2nd distinct task in a
 * turn, it blocks auto-execution and the model is told to use the bulk tool.
 * Heterogeneous ops (one reschedule + one complete) never trip it.
 */
export function makeFanOutGuard() {
  const counts: Record<string, number> = {};
  return {
    blocked(op: string): boolean {
      counts[op] = (counts[op] ?? 0) + 1;
      return counts[op] >= 2;
    },
  };
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** Expected minutes, capped at 24h like the action layer (docs/ESTIMATES.md DE3). */
const estimateMin = z.number().int().min(0).max(1440);

function brief(t: TaskDTO) {
  return {
    id: t.id,
    content: t.content,
    dueDate: t.dueDate,
    deadline: t.deadline,
    priority: t.priority,
    // Readable as well as writable on purpose: a field the model can set but
    // never see back is one it overwrites blind (docs/ESTIMATES.md §3.6).
    estimate: t.estimate,
    status: t.status,
    projectId: t.projectId,
  };
}

function blockedResult(op: string, bulkTool: string) {
  return {
    blocked: true,
    message:
      `Blocked: a second "${op}" on a different task in one turn must go through ${bulkTool} ` +
      `(which asks the user to confirm). Re-issue all affected tasks via ${bulkTool}, and tell the ` +
      `user which task was already applied and which still needs confirmation.`,
  };
}

export function buildTools(
  ctx: ToolContext,
  guard: ReturnType<typeof makeFanOutGuard>,
) {
  const { userId, today, inboxId } = ctx;

  return {
    listTasks: tool({
      description:
        "List the user's tasks by scope. 'today' = active due on/before today (overdue+today); " +
        "'overdue' = active due before today; 'week' = active due today..+6; 'inbox' = active in Inbox; " +
        "'all' = all active; 'completed' = completed (newest first).",
      inputSchema: z.object({
        scope: z.enum(["today", "overdue", "week", "inbox", "all", "completed"]),
        projectId: z.string().uuid().optional(),
        priority: z.number().int().min(1).max(4).optional(),
      }),
      execute: async ({ scope, projectId, priority }) => {
        const all = await listTasks(userId);
        const weekEnd = addDays(today, 6);
        let rows = all.filter((t) => {
          if (scope === "completed") return t.status === "completed";
          if (t.status !== "active") return false;
          switch (scope) {
            case "today":
              return t.dueDate !== null && t.dueDate <= today;
            case "overdue":
              return t.dueDate !== null && t.dueDate < today;
            case "week":
              return t.dueDate !== null && t.dueDate >= today && t.dueDate <= weekEnd;
            case "inbox":
              return t.projectId === inboxId;
            case "all":
              return true;
          }
        });
        if (projectId) rows = rows.filter((t) => t.projectId === projectId);
        if (priority) rows = rows.filter((t) => t.priority === priority);
        return { tasks: rows.map(brief) };
      },
    }),

    getTask: tool({
      description: "Get one task by id.",
      inputSchema: z.object({ id: z.string().uuid() }),
      execute: async ({ id }) => {
        const all = await listTasks(userId);
        const t = all.find((x) => x.id === id);
        return t ? brief(t) : { error: "not_found" };
      },
    }),

    listProjects: tool({
      description: "List the user's projects (Inbox first).",
      inputSchema: z.object({}),
      execute: async () => ({ projects: await listProjects(userId) }),
    }),

    createTask: tool({
      description:
        "Create a task. Omit dueDate for no date; omit projectId to use Inbox. " +
        "`dueDate` is the PLANNED date (when the user intends to do it); `deadline` is the " +
        "HARD date it's actually due — set deadline only when the user states a real deadline " +
        "('due Friday', 'must be done by...'), never inferred. " +
        "`estimate` is expected minutes (max 1440) — set it when the user says or implies " +
        "how long the work takes; omit it rather than guessing.",
      inputSchema: z.object({
        content: z.string().min(1).max(500),
        description: z.string().max(5000).nullish(),
        priority: z.number().int().min(1).max(4).optional(),
        dueDate: dateStr.nullish(),
        deadline: dateStr.nullish(),
        estimate: estimateMin.nullish(),
        projectId: z.string().uuid().nullish(),
      }),
      execute: async (input) => brief(await createTask(userId, input)),
    }),

    updateTask: tool({
      description:
        "Update a task's fields (content/description/priority/estimate/project/deadline). " +
        "For a PLANNED-date change use rescheduleTask instead. `deadline` is the hard date " +
        "the task is actually due — set/clear it only on the user's say-so (null clears). " +
        "`estimate` is expected minutes (max 1440); pass null to clear it.",
      inputSchema: z.object({
        id: z.string().uuid(),
        content: z.string().min(1).max(500).optional(),
        description: z.string().max(5000).nullable().optional(),
        priority: z.number().int().min(1).max(4).optional(),
        deadline: dateStr.nullable().optional(),
        estimate: estimateMin.nullable().optional(),
        projectId: z.string().uuid().optional(),
      }),
      execute: async ({ id, ...fields }) => {
        if (guard.blocked("updateTask")) return blockedResult("updateTask", "a follow-up message");
        return brief(await updateTask(userId, id, fields));
      },
    }),

    rescheduleTask: tool({
      description:
        "Change only a task's PLANNED date (dueDate). Never touches the deadline.",
      inputSchema: z.object({ id: z.string().uuid(), dueDate: dateStr }),
      execute: async ({ id, dueDate }) => {
        if (guard.blocked("rescheduleTask")) return blockedResult("rescheduleTask", "bulkReschedule");
        return brief(await updateTask(userId, id, { dueDate }));
      },
    }),

    completeTask: tool({
      description: "Mark a task completed.",
      inputSchema: z.object({ id: z.string().uuid() }),
      execute: async ({ id }) => {
        if (guard.blocked("completeTask")) return blockedResult("completeTask", "bulkComplete");
        return brief(await setTaskStatus(userId, id, "completed"));
      },
    }),

    uncompleteTask: tool({
      description: "Reopen a completed task (set it active again).",
      inputSchema: z.object({ id: z.string().uuid() }),
      execute: async ({ id }) => brief(await setTaskStatus(userId, id, "active")),
    }),

    deleteTask: tool({
      description: "Delete a task. Requires user confirmation.",
      inputSchema: z.object({ id: z.string().uuid() }),
      needsApproval: true,
      execute: async ({ id }) => {
        const ok = await deleteTask(userId, id);
        return ok ? { deleted: id } : { error: "not_found", id };
      },
    }),

    bulkReschedule: tool({
      description:
        "Reschedule many tasks to ONE shared due date. Requires user confirmation. " +
        "For different dates, call once per date.",
      inputSchema: z.object({
        ids: z.array(z.string().uuid()).min(1),
        dueDate: dateStr,
      }),
      needsApproval: true,
      execute: async ({ ids, dueDate }) => bulkReschedule(userId, ids, dueDate),
    }),

    bulkComplete: tool({
      description: "Complete many tasks. Requires user confirmation.",
      inputSchema: z.object({ ids: z.array(z.string().uuid()).min(1) }),
      needsApproval: true,
      execute: async ({ ids }) => bulkComplete(userId, ids),
    }),

    bulkDelete: tool({
      description: "Delete many tasks. Requires user confirmation.",
      inputSchema: z.object({ ids: z.array(z.string().uuid()).min(1) }),
      needsApproval: true,
      execute: async ({ ids }) => bulkDelete(userId, ids),
    }),
  };
}

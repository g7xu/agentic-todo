import type {
  CallToolResult,
  McpServer,
  ServerContext,
} from "@modelcontextprotocol/server";
import { z, ZodError } from "zod";
import { getTimezone } from "@/lib/data/profile";
import { createProject, listProjects } from "@/lib/data/projects";
import {
  listRoutineHistory,
  listRoutines,
  recordMissedDays,
} from "@/lib/data/routines";
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
import { addDays, diffDays, todayStr } from "@/lib/date";
import { cadenceLabel } from "@/lib/repeat";
import type { RoutineDayDTO } from "@/lib/data/routines";
import type { TaskDTO } from "@/lib/types";
import { projectNameSchema } from "@/lib/validation/projects";
import {
  clampHistoryDays,
  DEFAULT_HISTORY_DAYS,
  MAX_HISTORY_DAYS,
} from "@/lib/validation/routines";
import {
  createTaskSchema,
  dateStr,
  taskIdSchema,
  updateTaskSchema,
} from "@/lib/validation/tasks";

/**
 * The MCP tool surface (docs/MCP.md §2). Each tool is a thin adapter over a
 * `src/lib/data` function; nothing here reaches Prisma directly, and the user
 * id comes only from the verified bearer token (AG4, TDD §7).
 */

export const INSTRUCTIONS = `agenticTODO: the user's personal task system.
- A task has a planned date (dueDate: when they intend to do it) and an optional hard deadline. Moving work around changes dueDate; deadline changes only when the real due date changes.
- priority: 1 is highest, 4 is the default.
- Tasks live in projects; omit projectId to use the Inbox.
- Routines are recurring templates. Their daily outcomes appear as tasks with a routineId; they are read-only through this server.
- All dates are YYYY-MM-DD in the user's own timezone, which list_tasks reports as "today" and "timezone".
- Propose changes in conversation; the write tools are the user's explicit accept.`;

const WRITE_SCOPE = "tasks:write";
const MAX_BULK_IDS = 100;

/**
 * Messages the data layer throws for conditions the model can act on. Only
 * these exact strings reach the model; anything else is a server fault and
 * is replaced, because driver errors carry query text and file paths.
 */
const EXPECTED_DATA_ERRORS = new Set([
  "Task not found",
  "Project not found",
  "Routine not found",
  "Routine tasks can't change project",
  "Routine tasks can't be rescheduled",
  "The Inbox project cannot be deleted",
]);

/** A message composed inside a tool handler for the model to read. */
class ToolInputError extends Error {}

type Principal = { userId: string; scopes: string[] };

function principal(ctx: ServerContext): Principal {
  const info = ctx.http?.authInfo;
  const userId = info?.extra?.userId;
  if (!info || typeof userId !== "string") {
    throw new Error("tool invoked without a verified token");
  }
  return { userId, scopes: info.scopes };
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/**
 * Runs a tool body with the caller resolved. Expected failures (bad input,
 * an id the user does not own) become `isError` results the model can read
 * and recover from; anything else propagates as a protocol error.
 */
async function run(
  ctx: ServerContext,
  opts: { write?: boolean },
  body: (userId: string) => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const { userId, scopes } = principal(ctx);
    if (opts.write && !scopes.includes(WRITE_SCOPE)) {
      return fail(`This connection is read-only: the ${WRITE_SCOPE} scope was not granted.`);
    }
    return ok(await body(userId));
  } catch (e) {
    if (e instanceof ZodError) {
      const detail = e.issues
        .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
        .join("; ");
      return fail(`Invalid input: ${detail}`);
    }
    if (
      e instanceof ToolInputError ||
      (e instanceof Error && EXPECTED_DATA_ERRORS.has(e.message))
    ) {
      return fail(e.message);
    }
    // Anything else is a server fault. The SDK would otherwise hand the raw
    // message (driver errors include file paths) to the calling model.
    console.error("MCP tool failed:", e);
    return fail("The server hit an unexpected error. Nothing may have changed; check and retry.");
  }
}

/** The DTO without fields the model has no use for; nulls dropped to save tokens. */
function compactTask(t: TaskDTO) {
  const { order: _order, ...rest } = t;
  void _order;
  return Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== null),
  );
}

const idList = z.array(taskIdSchema).min(1).max(MAX_BULK_IDS);

const historySchema = z
  .object({
    days: z.number().int().min(1).max(MAX_HISTORY_DAYS).optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
  })
  .refine((v) => (v.from === undefined) === (v.to === undefined), {
    message: "from and to must be given together",
  });

export function registerTools(server: McpServer): void {
  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "Active tasks plus recently completed ones, with today's date and the user's timezone. Filter with status.",
      inputSchema: z.object({
        status: z.enum(["active", "completed"]).optional(),
      }),
    },
    (args, ctx) =>
      run(ctx, {}, async (userId) => {
        const timezone = await getTimezone(userId);
        const today = todayStr(timezone);
        // Mirrors GET /api/tasks: reading tasks is the moment past routine
        // days get recorded, and a failure there must not hide the tasks.
        try {
          await recordMissedDays(userId, today);
        } catch (e) {
          console.error("recordMissedDays failed:", e);
        }
        const tasks = await listTasks(userId, today);
        const filtered = args.status
          ? tasks.filter((t) => t.status === args.status)
          : tasks;
        return { today, timezone, tasks: filtered.map(compactTask) };
      }),
  );

  server.registerTool(
    "create_task",
    {
      title: "Create task",
      description:
        "Create one task. dueDate is the planned day; deadline is the hard due date. Omit projectId for the Inbox.",
      inputSchema: createTaskSchema,
    },
    (args, ctx) =>
      run(ctx, { write: true }, async (userId) =>
        compactTask(await createTask(userId, args)),
      ),
  );

  server.registerTool(
    "update_task",
    {
      title: "Update task",
      description:
        "Change fields of a task. Pass null to clear a date, estimate or description. Routine-day tasks cannot change project or dueDate.",
      inputSchema: updateTaskSchema.extend({ id: taskIdSchema }),
    },
    (args, ctx) =>
      run(ctx, { write: true }, async (userId) => {
        const { id, ...fields } = args;
        return compactTask(await updateTask(userId, id, fields));
      }),
  );

  server.registerTool(
    "complete_task",
    {
      title: "Complete task",
      description: "Mark a task done.",
      inputSchema: z.object({ id: taskIdSchema }),
    },
    (args, ctx) =>
      run(ctx, { write: true }, async (userId) => {
        const task = await setTaskStatus(userId, args.id, "completed");
        if (!task) throw new Error("Task not found");
        return compactTask(task);
      }),
  );

  server.registerTool(
    "uncomplete_task",
    {
      title: "Reopen task",
      description:
        "Mark a completed task active again. Reopening a routine day removes that day's record instead of returning a task.",
      inputSchema: z.object({ id: taskIdSchema }),
    },
    (args, ctx) =>
      run(ctx, { write: true }, async (userId) => {
        const task = await setTaskStatus(userId, args.id, "active");
        return task ? compactTask(task) : { removed: true, id: args.id };
      }),
  );

  server.registerTool(
    "delete_task",
    {
      title: "Delete task",
      description: "Permanently delete a task.",
      inputSchema: z.object({ id: taskIdSchema }),
    },
    (args, ctx) =>
      run(ctx, { write: true }, async (userId) => {
        if (!(await deleteTask(userId, args.id))) throw new Error("Task not found");
        return { deleted: true, id: args.id };
      }),
  );

  server.registerTool(
    "bulk_reschedule",
    {
      title: "Reschedule tasks",
      description:
        "Set the planned date of up to 100 tasks at once. Routine-day tasks are skipped.",
      inputSchema: z.object({ ids: idList, dueDate: dateStr }),
    },
    (args, ctx) =>
      run(ctx, { write: true }, (userId) =>
        bulkReschedule(userId, args.ids, args.dueDate),
      ),
  );

  server.registerTool(
    "bulk_complete",
    {
      title: "Complete tasks",
      description: "Mark up to 100 tasks done at once.",
      inputSchema: z.object({ ids: idList }),
    },
    (args, ctx) =>
      run(ctx, { write: true }, (userId) => bulkComplete(userId, args.ids)),
  );

  server.registerTool(
    "bulk_delete",
    {
      title: "Delete tasks",
      description: "Permanently delete up to 100 tasks at once.",
      inputSchema: z.object({ ids: idList }),
    },
    (args, ctx) =>
      run(ctx, { write: true }, (userId) => bulkDelete(userId, args.ids)),
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "The user's projects, Inbox first.",
      inputSchema: z.object({}),
    },
    (_args, ctx) => run(ctx, {}, (userId) => listProjects(userId)),
  );

  server.registerTool(
    "create_project",
    {
      title: "Create project",
      description: "Create a project.",
      inputSchema: z.object({ name: projectNameSchema }),
    },
    (args, ctx) =>
      run(ctx, { write: true }, (userId) => createProject(userId, args.name)),
  );

  server.registerTool(
    "list_routines",
    {
      title: "List routines",
      description:
        "Recurring templates with a readable cadence. Read-only here; edit routines in the app.",
      inputSchema: z.object({}),
    },
    (_args, ctx) =>
      run(ctx, {}, async (userId) =>
        (await listRoutines(userId)).map((r) => ({
          ...r,
          cadence: cadenceLabel(r),
        })),
      ),
  );

  server.registerTool(
    "get_routine_history",
    {
      title: "Routine history",
      description:
        "Per-routine done/missed counts and day-by-day outcomes over a window ending today (default 84 days, max 371), or an explicit from/to range.",
      inputSchema: historySchema,
    },
    (args, ctx) =>
      run(ctx, {}, async (userId) => {
        const tz = await getTimezone(userId);
        const today = todayStr(tz);
        let from: string;
        let to: string;
        if (args.from !== undefined && args.to !== undefined) {
          if (diffDays(args.from, args.to) < 0) {
            throw new ToolInputError("from must be on or before to");
          }
          if (diffDays(args.from, args.to) >= MAX_HISTORY_DAYS) {
            throw new ToolInputError(`the window must be at most ${MAX_HISTORY_DAYS} days`);
          }
          from = args.from;
          to = args.to;
        } else {
          const days = clampHistoryDays(args.days ?? DEFAULT_HISTORY_DAYS);
          to = today;
          from = addDays(to, -(days - 1));
        }
        const [routines, days] = await Promise.all([
          listRoutines(userId),
          listRoutineHistory(userId, from, to, tz),
        ]);
        return { from, to, routines: summarize(routines, days) };
      }),
  );
}

function summarize(
  routines: Awaited<ReturnType<typeof listRoutines>>,
  days: RoutineDayDTO[],
) {
  const byRoutine = new Map<string, RoutineDayDTO[]>();
  for (const d of days) {
    const list = byRoutine.get(d.routineId) ?? [];
    list.push(d);
    byRoutine.set(d.routineId, list);
  }
  return routines.map((r) => {
    const rows = byRoutine.get(r.id) ?? [];
    return {
      id: r.id,
      content: r.content,
      cadence: cadenceLabel(r),
      active: r.active,
      done: rows.filter((d) => d.status === "completed").length,
      missed: rows.filter((d) => d.status === "missed").length,
      days: rows.map((d) => ({
        date: d.date,
        status: d.status,
        madeUp: d.madeUp || undefined,
      })),
    };
  });
}

import type {
  CallToolResult,
  McpServer,
  ServerContext,
} from "@modelcontextprotocol/server";
import { z, ZodError } from "zod";
import {
  AGENT_ERRORS,
  claimTask,
  finishTask,
  listTaskActivity,
  logProgress,
  MAX_LEASE_MIN,
  releaseTask,
  requestInput,
} from "@/lib/data/agent-tasks";
import { getTimezone } from "@/lib/data/profile";
import {
  createProject,
  deleteProjectReassign,
  listProjects,
  renameProject,
} from "@/lib/data/projects";
import {
  addNote,
  closeReview,
  deleteNote,
  getReview,
  listCompletedBetween,
  listReviews,
  moveNote,
  REVIEW_CLOSED,
  updateNote,
} from "@/lib/data/reviews";
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
  getTask,
  listTasks,
  setTaskStatus,
  updateTask,
} from "@/lib/data/tasks";
import { addDays, diffDays, startOfWeek, todayStr } from "@/lib/date";
import { cadenceLabel } from "@/lib/repeat";
import { MAX_CARRIED } from "@/lib/reviews";
import type { RoutineDayDTO } from "@/lib/data/routines";
import { AGENT_STATES, type ReviewNoteDTO, type TaskDTO } from "@/lib/types";
import {
  idSchema as projectIdSchema,
  projectNameSchema,
} from "@/lib/validation/projects";
import {
  carriedIdsSchema,
  noteContentSchema,
  noteIdSchema,
  noteKindSchema,
} from "@/lib/validation/reviews";
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
- Weekly reviews are boards keyed by the Sunday that starts the week. Notes sit in the unsorted pile or in one of four columns: thorn (what stung), rose (what went well), seed (worth trying), action (what to do next).
- Closing a week makes its board read-only, turns up to ${MAX_CARRIED} chosen action notes into Inbox tasks planned for the next Sunday, and moves unsorted notes to the next open week. There is no reopen.
- Writes take effect immediately; the server keeps no drafts and has no undo.
- Agent hand-off: agentState marks the tasks the user handed to an agent. "ready" tasks are waiting; claim_task gives one run a claimId that log_task_progress, request_input, release_task and finish_task require, so two runs cannot work the same task. "needs_input" tasks wait on the user's answer to agentQuestion, which arrives in the task's log (get_task). "suggested" tasks came from suggest_task and become "ready" only when the user hands them over. Tasks with no agentState belong to the user alone. Reports go in the log; the description stays the user's.`;

const WRITE_SCOPE = "tasks:write";
/** The hand-off tools alone: no general edits and no deletes (docs/AGENT-TASKS.md AT7). */
const AGENT_SCOPE = "tasks:agent";
const MAX_BULK_IDS = 100;

/**
 * Tool annotations (MCP spec). Every tool acts only on the caller's own
 * rows, so none is open-world. `destructiveHint: false` promises purely
 * additive updates, which only the two creates keep: every other write
 * overwrites or removes existing rows (an update can clear a deadline, a
 * reschedule replaces planned dates, reopening a routine day deletes its
 * record), and clients use the hint to decide whether to confirm first.
 */
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const ADD = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const CHANGE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;
/** Hand-off moves: they change only the agent's own state and log, never the user's fields. */
const HANDOFF = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

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
  "Missed routine days can't be completed",
  "The Inbox project cannot be deleted",
  "Note not found",
  "Review not found",
  REVIEW_CLOSED,
  "Only this week's action notes can be carried",
  ...Object.values(AGENT_ERRORS),
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
  opts: { write?: boolean; agent?: boolean },
  body: (userId: string) => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const { userId, scopes } = principal(ctx);
    if (opts.write && !scopes.includes(WRITE_SCOPE)) {
      return fail(
        scopes.includes(AGENT_SCOPE)
          ? `This connection may only use the agent hand-off tools: the ${WRITE_SCOPE} scope was not granted.`
          : `This connection is read-only: the ${WRITE_SCOPE} scope was not granted.`,
      );
    }
    if (opts.agent && !scopes.includes(WRITE_SCOPE) && !scopes.includes(AGENT_SCOPE)) {
      return fail(`This connection is read-only: neither ${AGENT_SCOPE} nor ${WRITE_SCOPE} was granted.`);
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

/** Notes without ordering bookkeeping; a carriedTaskId only once it exists. */
function compactNote(n: ReviewNoteDTO) {
  return {
    id: n.id,
    kind: n.kind,
    content: n.content,
    ...(n.carriedTaskId ? { carriedTaskId: n.carriedTaskId } : {}),
  };
}

const idList = z.array(taskIdSchema).min(1).max(MAX_BULK_IDS);

/** Any day names its week, so the model never has to work out the Sunday. */
const weekInput = dateStr
  .optional()
  .describe("Any YYYY-MM-DD inside the week. Defaults to the current week.");

async function resolveWeek(userId: string, day: string | undefined) {
  const tz = await getTimezone(userId);
  return { tz, week: startOfWeek(day ?? todayStr(tz)) };
}

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
      annotations: READ,
      description:
        "Active tasks plus recently completed ones, with today's date and the user's timezone. Filter with status, projectId, or agentState (\"ready\" lists the tasks handed to the agent and waiting).",
      inputSchema: z.object({
        status: z.enum(["active", "completed"]).optional(),
        projectId: projectIdSchema.optional(),
        agentState: z.enum(AGENT_STATES as [string, ...string[]]).optional(),
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
        const filtered = tasks.filter(
          (t) =>
            (!args.status || t.status === args.status) &&
            (!args.projectId || t.projectId === args.projectId) &&
            (!args.agentState || t.agentState === args.agentState),
        );
        return { today, timezone, tasks: filtered.map(compactTask) };
      }),
  );

  server.registerTool(
    "create_task",
    {
      title: "Create task",
      annotations: ADD,
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
      annotations: CHANGE,
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
      annotations: CHANGE,
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
      annotations: CHANGE,
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
      annotations: CHANGE,
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
      annotations: CHANGE,
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
      annotations: CHANGE,
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
      annotations: CHANGE,
      description: "Permanently delete up to 100 tasks at once.",
      inputSchema: z.object({ ids: idList }),
    },
    (args, ctx) =>
      run(ctx, { write: true }, (userId) => bulkDelete(userId, args.ids)),
  );

  server.registerTool(
    "get_task",
    {
      title: "Get task",
      annotations: READ,
      description:
        "One task with its agent log: progress notes, questions, the user's answers and reports, oldest first.",
      inputSchema: z.object({ id: taskIdSchema }),
    },
    (args, ctx) =>
      run(ctx, {}, async (userId) => {
        const task = await getTask(userId, args.id);
        if (!task) throw new Error("Task not found");
        return { task: compactTask(task), log: await listTaskActivity(userId, args.id) };
      }),
  );

  server.registerTool(
    "claim_task",
    {
      title: "Claim task",
      annotations: HANDOFF,
      description: `Claim a task handed to the agent so no other run works it. Without id, claims the next ready task by priority, deadline and planned date; returns claimed: null when none is waiting. The result carries the claimId the other hand-off tools require, when the claim lapses (leaseMinutes, default 30, at most ${MAX_LEASE_MIN}), and the task's recent log. A lapsed claim may be taken over by another run.`,
      inputSchema: z.object({
        id: taskIdSchema.optional(),
        leaseMinutes: z.number().int().min(1).max(MAX_LEASE_MIN).optional(),
      }),
    },
    (args, ctx) =>
      run(ctx, { agent: true }, async (userId) => {
        const claimed = await claimTask(userId, args);
        if (!claimed) return { claimed: null };
        return { claimed: { ...claimed, task: compactTask(claimed.task) } };
      }),
  );

  const claimInput = {
    id: taskIdSchema,
    claimId: z.string().uuid().describe("The claimId claim_task returned."),
  };
  const logText = z.string().trim().min(1).max(10000);

  server.registerTool(
    "log_task_progress",
    {
      title: "Log task progress",
      annotations: HANDOFF,
      description:
        "Add a progress note to a claimed task's log and renew its claim for leaseMinutes (default 30).",
      inputSchema: z.object({
        ...claimInput,
        note: logText,
        leaseMinutes: z.number().int().min(1).max(MAX_LEASE_MIN).optional(),
      }),
    },
    (args, ctx) =>
      run(ctx, { agent: true }, (userId) =>
        logProgress(userId, args.id, args.claimId, args.note, args.leaseMinutes),
      ),
  );

  server.registerTool(
    "request_input",
    {
      title: "Ask the user",
      annotations: HANDOFF,
      description:
        "Set a claimed task to needs_input with one question for the user and release the claim. The user's answer appears in the log and the task returns to ready.",
      inputSchema: z.object({ ...claimInput, question: z.string().trim().min(1).max(2000) }),
    },
    (args, ctx) =>
      run(ctx, { agent: true }, async (userId) =>
        compactTask(await requestInput(userId, args.id, args.claimId, args.question)),
      ),
  );

  server.registerTool(
    "release_task",
    {
      title: "Release task",
      annotations: HANDOFF,
      description:
        "Put a claimed task back to ready without finishing it, with an optional note for the next run.",
      inputSchema: z.object({ ...claimInput, note: logText.optional() }),
    },
    (args, ctx) =>
      run(ctx, { agent: true }, async (userId) =>
        compactTask(await releaseTask(userId, args.id, args.claimId, args.note)),
      ),
  );

  server.registerTool(
    "finish_task",
    {
      title: "Finish task",
      annotations: CHANGE,
      description:
        "Complete a claimed task and add the report to its log: what was done, the answer, and links to anything made. The task's description is left unchanged.",
      inputSchema: z.object({ ...claimInput, report: logText }),
    },
    (args, ctx) =>
      run(ctx, { agent: true }, async (userId) =>
        compactTask(await finishTask(userId, args.id, args.claimId, args.report)),
      ),
  );

  server.registerTool(
    "suggest_task",
    {
      title: "Suggest task",
      annotations: ADD,
      description:
        "Create a task marked as suggested by the agent. It is not claimable until the user hands it over. Same fields as create_task.",
      inputSchema: createTaskSchema,
    },
    (args, ctx) =>
      run(ctx, { agent: true }, async (userId) =>
        compactTask(await createTask(userId, args, { suggestedByAgent: true })),
      ),
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      annotations: READ,
      description: "The user's projects, Inbox first.",
      inputSchema: z.object({}),
    },
    (_args, ctx) => run(ctx, {}, (userId) => listProjects(userId)),
  );

  server.registerTool(
    "create_project",
    {
      title: "Create project",
      annotations: ADD,
      description: "Create a project.",
      inputSchema: z.object({ name: projectNameSchema }),
    },
    (args, ctx) =>
      run(ctx, { write: true }, (userId) => createProject(userId, args.name)),
  );

  server.registerTool(
    "update_project",
    {
      title: "Rename project",
      annotations: CHANGE,
      description: "Change a project's name. The Inbox can be renamed too.",
      inputSchema: z.object({ id: projectIdSchema, name: projectNameSchema }),
    },
    (args, ctx) =>
      run(ctx, { write: true }, async (userId) => {
        if (!(await renameProject(userId, args.id, args.name))) {
          throw new Error("Project not found");
        }
        return { id: args.id, name: args.name };
      }),
  );

  server.registerTool(
    "delete_project",
    {
      title: "Delete project",
      annotations: CHANGE,
      description:
        "Permanently delete a project. Its tasks and routines move to the Inbox. The Inbox cannot be deleted.",
      inputSchema: z.object({ id: projectIdSchema }),
    },
    (args, ctx) =>
      run(ctx, { write: true }, async (userId) => {
        await deleteProjectReassign(userId, args.id);
        return { deleted: true, id: args.id };
      }),
  );

  server.registerTool(
    "list_routines",
    {
      title: "List routines",
      annotations: READ,
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
      annotations: READ,
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

  server.registerTool(
    "list_reviews",
    {
      title: "List weekly reviews",
      annotations: READ,
      description:
        "Every week that has a review, newest first, with its note count per column and when it was closed. Weeks nobody wrote in are absent.",
      inputSchema: z.object({}),
    },
    (_args, ctx) => run(ctx, {}, (userId) => listReviews(userId)),
  );

  server.registerTool(
    "get_review",
    {
      title: "Get weekly review",
      annotations: READ,
      description:
        "One week's board: its notes in order, whether it is closed, and the one-off tasks completed that week. notes is empty for a week nobody wrote in.",
      inputSchema: z.object({ week: weekInput }),
    },
    (args, ctx) =>
      run(ctx, {}, async (userId) => {
        const { tz, week } = await resolveWeek(userId, args.week);
        const [review, completed] = await Promise.all([
          getReview(userId, week),
          listCompletedBetween(userId, week, addDays(week, 6), tz),
        ]);
        return {
          week,
          thisWeek: startOfWeek(todayStr(tz)),
          closedAt: review?.closedAt ?? null,
          notes: (review?.notes ?? []).map(compactNote),
          completed: completed.map(compactTask),
        };
      }),
  );

  server.registerTool(
    "add_review_note",
    {
      title: "Add review note",
      annotations: ADD,
      description:
        "Add a note at the end of a column of a week's board, creating the week's review if it has none. kind defaults to unsorted.",
      inputSchema: z.object({
        week: weekInput,
        kind: noteKindSchema.optional(),
        content: noteContentSchema,
      }),
    },
    (args, ctx) =>
      run(ctx, { write: true }, async (userId) => {
        const { week } = await resolveWeek(userId, args.week);
        const note = await addNote(userId, week, {
          kind: args.kind ?? "unsorted",
          content: args.content,
        });
        return { week, ...compactNote(note) };
      }),
  );

  server.registerTool(
    "update_review_note",
    {
      title: "Edit review note",
      annotations: CHANGE,
      description: "Replace a note's text. Notes on a closed week are read-only.",
      inputSchema: z.object({ id: noteIdSchema, content: noteContentSchema }),
    },
    (args, ctx) =>
      run(ctx, { write: true }, async (userId) =>
        compactNote(await updateNote(userId, args.id, args.content)),
      ),
  );

  server.registerTool(
    "move_review_note",
    {
      title: "Move review note",
      annotations: CHANGE,
      description:
        "Move a note to the end of another column or of the unsorted pile. Notes on a closed week are read-only.",
      inputSchema: z.object({ id: noteIdSchema, kind: noteKindSchema }),
    },
    (args, ctx) =>
      run(ctx, { write: true }, async (userId) =>
        compactNote(await moveNote(userId, args.id, { kind: args.kind })),
      ),
  );

  server.registerTool(
    "delete_review_note",
    {
      title: "Delete review note",
      annotations: CHANGE,
      description: "Permanently delete a note. Notes on a closed week are read-only.",
      inputSchema: z.object({ id: noteIdSchema }),
    },
    (args, ctx) =>
      run(ctx, { write: true }, async (userId) => {
        await deleteNote(userId, args.id);
        return { deleted: true, id: args.id };
      }),
  );

  server.registerTool(
    "close_review",
    {
      title: "Close weekly review",
      annotations: CHANGE,
      description: `Close a week for good. Each action note in carry (at most ${MAX_CARRIED}, possibly none) becomes an Inbox task planned for the next Sunday; unsorted notes move to the next open week; the board becomes read-only and cannot be reopened.`,
      inputSchema: z.object({ week: dateStr, carry: carriedIdsSchema }),
    },
    (args, ctx) =>
      run(ctx, { write: true }, async (userId) => {
        const review = await closeReview(userId, startOfWeek(args.week), args.carry);
        return {
          week: review.weekStart,
          closedAt: review.closedAt,
          notes: review.notes.map(compactNote),
        };
      }),
  );

  server.registerPrompt(
    "weekly_review",
    {
      title: "Draft my weekly review",
      description:
        "Reads the week's finished tasks, routine record and open work, drafts notes onto the review board, and suggests which actions to carry.",
      argsSchema: z.object({
        week: dateStr
          .optional()
          .describe("Any YYYY-MM-DD inside the week. Defaults to the current week."),
      }),
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: weeklyReviewPrompt(args.week) },
        },
      ],
    }),
  );
}

function weeklyReviewPrompt(week: string | undefined): string {
  const which = week ? `the week containing ${week}` : "this week";
  const weekArg = week ? `{ week: "${week}" }` : "with no week";
  return `Draft my weekly review for ${which}.

1. Gather the evidence: get_review ${weekArg} for the board and the tasks I finished; get_routine_history with that week's Sunday-to-Saturday as from/to; list_tasks for what is still open or overdue.
2. Write notes with add_review_note. Each note is one short, concrete sentence tied to something in the evidence: thorn for what stung (missed routines, slipped or overdue work), rose for what went well, seed for something worth trying, action for one specific thing to do next week. A thought whose column is unclear goes in unsorted. Skip anything the board already says.
3. Show me what you added, column by column, and suggest up to ${MAX_CARRIED} actions to carry into next week. Close the week with close_review only after I say which ones to carry.`;
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

import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, UnauthenticatedError } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { addDays, todayStr } from "@/lib/date";
import { chatModel } from "@/lib/ai/config";
import { consumeAiRequest, RateLimitError } from "@/lib/ai/rate-limit";
import { aiErrorMessage, isQuotaError } from "@/lib/ai/errors";
import {
  applyReviewPlan,
  gatherIncomplete,
  type ApplyItem,
} from "@/lib/data/review";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// The model proposes only taskId/toDate/reason; the server attaches fromDate.
const MovesSchema = z.object({
  moves: z.array(
    z.object({
      taskId: z.string(),
      toDate: dateStr,
      reason: z.string().max(300),
    }),
  ),
});

const applyItemSchema = z.object({
  taskId: z.string().uuid(),
  fromDate: dateStr,
  toDate: dateStr,
});

const bodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("propose") }),
  z.object({ mode: z.literal("apply"), items: z.array(applyItemSchema) }),
]);

export async function POST(req: Request) {
  let user: { id: string; email: string };
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw e;
  }

  const body = bodySchema.parse(await req.json());
  const profile = await prisma.profile.findUnique({
    where: { id: user.id },
    select: { timezone: true },
  });
  const tz = profile?.timezone ?? "UTC";
  const today = todayStr(tz);

  // ---- apply (no model call, not rate-limited) ----
  if (body.mode === "apply") {
    const result = await applyReviewPlan(user.id, today, body.items as ApplyItem[]);
    return NextResponse.json(result);
  }

  // ---- propose ----
  const tasks = await gatherIncomplete(user.id, today);
  if (tasks.length === 0) {
    return NextResponse.json({ plan: [], empty: true });
  }

  try {
    await consumeAiRequest(user.id, user.email);
  } catch (e) {
    if (e instanceof RateLimitError) {
      return NextResponse.json(
        { error: "Daily AI request limit reached. Try again tomorrow." },
        { status: 429 },
      );
    }
    throw e;
  }

  const weekEnd = addDays(today, 6);
  const list = tasks
    .map((t) => `- [${t.id}] ${t.content} (due ${t.dueDate}, p${t.priority})`)
    .join("\n");
  const prompt = [
    `Today is ${today}. The user is reviewing incomplete tasks (overdue or due today).`,
    `Propose a new due date for each task to reorganize the coming days.`,
    `Every toDate MUST be between ${today} and ${weekEnd} (inclusive) — never in the past, never beyond ${weekEnd}.`,
    `Spread work sensibly; keep higher priority (lower number) sooner. Give a short reason per task.`,
    `Only use these task ids:`,
    list,
  ].join("\n");

  // generateObject validates against the schema; retry once on failure.
  let moves: z.infer<typeof MovesSchema>["moves"];
  try {
    const { object } = await generateObject({
      model: chatModel,
      schema: MovesSchema,
      prompt,
    });
    moves = object.moves;
  } catch {
    try {
      const { object } = await generateObject({
        model: chatModel,
        schema: MovesSchema,
        prompt,
      });
      moves = object.moves;
    } catch (e) {
      return NextResponse.json(
        { error: aiErrorMessage(e) },
        { status: isQuotaError(e) ? 429 : 502 },
      );
    }
  }

  // Attach fromDate/content from the gathered set; ignore unknown ids; clamp horizon.
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const plan = moves
    .map((m) => {
      const task = byId.get(m.taskId);
      if (!task || task.dueDate === null) return null;
      let toDate = m.toDate;
      let note: string | undefined;
      if (toDate < today) {
        toDate = today;
        note = "clamped";
      } else if (toDate > weekEnd) {
        toDate = weekEnd;
        note = "clamped";
      }
      return {
        taskId: task.id,
        content: task.content,
        fromDate: task.dueDate,
        toDate,
        reason: m.reason,
        note,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return NextResponse.json({ plan });
}

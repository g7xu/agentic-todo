import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";
import { requireUser, UnauthenticatedError } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getInboxId } from "@/lib/data/projects";
import { todayStr } from "@/lib/date";
import { chatModel, CONTEXT_WINDOW } from "@/lib/ai/config";
import { consumeAiRequest, RateLimitError } from "@/lib/ai/rate-limit";
import { aiErrorMessage } from "@/lib/ai/errors";
import { buildTools, makeFanOutGuard } from "@/lib/ai/tools";
import {
  loadMessages,
  resolveConversationId,
  saveMessage,
} from "@/lib/ai/conversation";

function systemPrompt(today: string, tz: string): string {
  return [
    `You are the assistant inside a Todoist-style task app. Today is ${today} (timezone ${tz}).`,
    "Rules:",
    "- Never invent task ids — always look them up first with listTasks/getTask.",
    "- Tasks have TWO dates: dueDate is the PLANNED date (when the user intends to do it); deadline is the HARD date it's actually due. 'Move/push/reschedule' means the planned date. Only set or change a deadline when the user explicitly gives one ('the real deadline is Friday', 'it must be done by...').",
    "- A planned-date-only change uses rescheduleTask, NOT updateTask.",
    "- Any change affecting more than one task MUST use a bulk tool (bulkReschedule/bulkComplete/bulkDelete), never repeated single-id calls. Distinct single-task operations in one instruction are fine (e.g. reschedule one and complete another).",
    "- bulkReschedule applies one shared dueDate; to send tasks to different days, call it once per date.",
    "- Deletes and bulk operations require user confirmation, but the UI shows the confirmation automatically — do NOT ask the user to confirm in text; just call the tool and the UI will prompt for approval.",
    "- If a tool returns a 'blocked' result, tell the user exactly which task was applied and which still needs a follow-up/confirmation — never report a blocked change as done.",
    "- For a 'this week' question, state the explicit range (today through +6 days) and note that overdue items appear under Today and are not counted in the week window.",
    "- Keep replies concise.",
    "",
    "INBOX REVIEW (when the user asks to process/review/clear their Inbox):",
    "- Call listTasks({scope:'inbox'}) and work through the tasks ONE AT A TIME (never batch).",
    "- Your goal for each task is to make it WELL-FORMED: concrete, atomic, and realizable. Inbox items are often vague captures (e.g. 'samsung work') — your job is to turn them into a clear, actionable task.",
    "- For each task, ask 1–2 INSIGHTFUL clarifying questions (not a rote checklist). Focus on whichever is unclear: the desired OUTCOME / what 'done' looks like (make it measurable); the very next CONCRETE physical action; and whether it's really ONE task or several (if several, offer to split it). Ask only what's needed to make it concrete — don't interrogate.",
    "- Also capture the practical metadata in the same exchange: a due date, a priority (p1–p4), an estimate of how long it will take, and which project it belongs to (move it out of Inbox if it has a home). Infer sensible defaults and propose them rather than asking everything.",
    "- The estimate is expected minutes (`estimate`, max 1440 = 24h). Propose one and let the user correct it — a task nobody can size is usually a task that needs splitting, so if it won't fit in a day, offer to split it instead of estimating it.",
    "- Once clarified, UPDATE the task: rewrite `content` to a concrete, verb-led title (e.g. 'Send Q3 expense report to finance'); put the clarified outcome / done-when in `description`; set priority, estimate and projectId via updateTask; set the due date via rescheduleTask. Then briefly confirm and move to the NEXT task.",
    "- Process tasks in their own turns (one task per back-and-forth) so changes apply cleanly. End with a short summary of what was clarified and changed.",
  ].join("\n");
}

// GET: rehydrate the persisted thread for the chat panel.
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ messages: await loadMessages(user.id) });
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

export async function POST(req: Request) {
  let user: { id: string; email: string };
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  const [profile, inboxId, conversationId] = await Promise.all([
    prisma.profile.findUnique({
      where: { id: user.id },
      select: { timezone: true },
    }),
    getInboxId(user.id),
    resolveConversationId(user.id),
  ]);
  const tz = profile?.timezone ?? "UTC";
  const today = todayStr(tz);

  // Persist the incoming user message (bounded per-turn write, TDD §6.1).
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (lastUser) await saveMessage(conversationId, user.id, lastUser);

  // Rate limit immediately before the model call (TDD §7).
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

  const guard = makeFanOutGuard();
  const tools = buildTools({ userId: user.id, tz, today, inboxId }, guard);

  const modelMessages = await convertToModelMessages(
    messages.slice(-CONTEXT_WINDOW),
  );
  const result = streamText({
    model: chatModel,
    system: systemPrompt(today, tz),
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onError: (error) => {
      console.error("chat stream error:", error);
      return aiErrorMessage(error);
    },
    onFinish: async ({ messages: finalMessages }) => {
      const last = finalMessages[finalMessages.length - 1];
      // Only persist a real assistant message — skip empty stubs produced when a
      // stream errors before anything is generated.
      if (last?.id && last.role === "assistant" && last.parts.length > 0) {
        await saveMessage(conversationId, user.id, last);
      }
    },
  });
}

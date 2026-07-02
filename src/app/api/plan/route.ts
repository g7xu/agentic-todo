import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, UnauthenticatedError } from "@/lib/auth/session";
import { chatModel } from "@/lib/ai/config";
import { consumeAiRequest, RateLimitError } from "@/lib/ai/rate-limit";
import { aiErrorMessage, isQuotaError } from "@/lib/ai/errors";
import { bulkCreateTasks } from "@/lib/data/tasks";

const TasksSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        priority: z.number().int().min(1).max(4).optional(),
        note: z.string().max(500).optional(),
      }),
    )
    .max(25),
});

const applyItem = z.object({
  title: z.string().trim().min(1).max(300),
  priority: z.number().int().min(1).max(4).optional(),
  note: z.string().max(500).nullish(),
});

const bodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("propose"), text: z.string().min(1).max(4000) }),
  z.object({ mode: z.literal("apply"), items: z.array(applyItem).min(1) }),
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

  // ---- apply: create the (possibly edited) plan, no model call ----
  if (body.mode === "apply") {
    const result = await bulkCreateTasks(
      user.id,
      body.items.map((i) => ({
        content: i.title,
        priority: i.priority,
        description: i.note ?? null,
      })),
    );
    return NextResponse.json(result);
  }

  // ---- propose: decompose the brain-dump into atomic tasks ----
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

  const prompt = [
    "The user brain-dumped the following. Split it into ATOMIC, well-formed tasks:",
    "- one clear outcome per task, verb-led concrete titles (e.g. 'Record a product demo video').",
    "- Keep genuinely distinct items separate; do NOT merge them, and do NOT invent tasks that aren't implied.",
    "- For each, optionally infer a priority (1=highest … 4=default) and a short note capturing intent.",
    "",
    "Brain-dump:",
    body.text,
  ].join("\n");

  let tasks: z.infer<typeof TasksSchema>["tasks"];
  try {
    const { object } = await generateObject({
      model: chatModel,
      schema: TasksSchema,
      prompt,
    });
    tasks = object.tasks;
  } catch {
    try {
      const { object } = await generateObject({
        model: chatModel,
        schema: TasksSchema,
        prompt,
      });
      tasks = object.tasks;
    } catch (e) {
      return NextResponse.json(
        { error: aiErrorMessage(e) },
        { status: isQuotaError(e) ? 429 : 502 },
      );
    }
  }

  return NextResponse.json({ tasks });
}

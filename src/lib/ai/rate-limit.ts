import { prisma } from "@/lib/db";
import { DAILY_REQUEST_CAP, OWNER_EMAILS } from "@/lib/ai/config";

export class RateLimitError extends Error {
  constructor() {
    super("RATE_LIMIT_EXCEEDED");
    this.name = "RateLimitError";
  }
}

/**
 * Atomically increment the user's per-UTC-day model-request counter and reject
 * over the cap (TDD §7). Call immediately before the model call (chat
 * `streamText` / review `generateObject`), never as a top-of-handler gate.
 * Allowlisted owners bypass entirely (counter neither checked nor incremented).
 */
export async function consumeAiRequest(
  userId: string,
  email: string,
): Promise<void> {
  if (OWNER_EMAILS.includes(email.toLowerCase())) return;

  const day = new Date().toISOString().slice(0, 10); // UTC day
  const row = await prisma.dailyUsage.upsert({
    where: { userId_day: { userId, day } },
    update: { count: { increment: 1 } },
    create: { userId, day, count: 1 },
  });
  if (row.count > DAILY_REQUEST_CAP) throw new RateLimitError();
}

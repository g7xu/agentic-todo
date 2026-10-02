import { NextResponse } from "next/server";
import { requireUser, UnauthenticatedError } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { todayStr } from "@/lib/date";
import { listTasks } from "@/lib/data/tasks";
import { recordMissedDays } from "@/lib/data/routines";

export async function GET() {
  try {
    const user = await requireUser();
    const profile = await prisma.profile.findUnique({
      where: { id: user.id },
      select: { timezone: true },
    });
    const today = todayStr(profile?.timezone ?? "UTC");

    // The tasks read is the single fetch behind the ['tasks'] query, so it
    // doubles as the moment past routine days get recorded. A failure here
    // must not take down every task view — log it and serve tasks; the next
    // read retries (the step is idempotent).
    try {
      await recordMissedDays(user.id, today);
    } catch (e) {
      console.error("recordMissedDays failed:", e);
    }

    return NextResponse.json({ tasks: await listTasks(user.id, today) });
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

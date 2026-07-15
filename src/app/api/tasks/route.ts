import { NextResponse } from "next/server";
import { requireUser, UnauthenticatedError } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { todayStr } from "@/lib/date";
import { listTasks } from "@/lib/data/tasks";
import { materializeRoutines } from "@/lib/data/routines";

export async function GET() {
  try {
    const user = await requireUser();
    const profile = await prisma.profile.findUnique({
      where: { id: user.id },
      select: { timezone: true },
    });
    const today = todayStr(profile?.timezone ?? "UTC");

    // Lazy routine materialization (docs/ROUTINES.md §3.2): the tasks read is
    // the single fetch behind the ['tasks'] query, so it doubles as the
    // scheduler. A failure here must not take down every task view — log it
    // and serve tasks; the next read retries (the step is idempotent).
    try {
      await materializeRoutines(user.id, today);
    } catch (e) {
      console.error("materializeRoutines failed:", e);
    }

    return NextResponse.json({ tasks: await listTasks(user.id) });
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

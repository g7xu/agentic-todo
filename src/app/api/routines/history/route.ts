import { NextResponse } from "next/server";
import { requireUser, UnauthenticatedError } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { addDays, todayStr } from "@/lib/date";
import { listRoutineHistory } from "@/lib/data/routines";

/** Widest window the grid offers, so a crafted `days` can't ask for years. */
const MAX_DAYS = 371;

/**
 * Recorded routine outcomes for the Activity grid (docs/ROUTINES.md §RV8).
 * The window ends at the user's local today and runs back `days` days.
 * Unlike GET /api/tasks this records nothing — reading your history must
 * never write to it.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const profile = await prisma.profile.findUnique({
      where: { id: user.id },
      select: { timezone: true },
    });
    const tz = profile?.timezone ?? "UTC";
    const to = todayStr(tz);

    const raw = Number(new URL(req.url).searchParams.get("days"));
    const days = Number.isFinite(raw)
      ? Math.min(Math.max(Math.trunc(raw), 1), MAX_DAYS)
      : 84;
    const from = addDays(to, -(days - 1));

    return NextResponse.json({
      from,
      to,
      days: await listRoutineHistory(user.id, from, to, tz),
    });
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

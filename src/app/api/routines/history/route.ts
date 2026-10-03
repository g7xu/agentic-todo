import { NextResponse } from "next/server";
import { requireUser, UnauthenticatedError } from "@/lib/auth/session";
import { getTimezone } from "@/lib/data/profile";
import { addDays, todayStr } from "@/lib/date";
import { listRoutineHistory } from "@/lib/data/routines";
import { clampHistoryDays } from "@/lib/validation/routines";

/**
 * Recorded routine outcomes for the Activity grid (docs/ROUTINES.md §RV8).
 * The window ends at the user's local today and runs back `days` days.
 * Unlike GET /api/tasks this records nothing — reading your history must
 * never write to it.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const tz = await getTimezone(user.id);
    const to = todayStr(tz);

    const days = clampHistoryDays(new URL(req.url).searchParams.get("days"));
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

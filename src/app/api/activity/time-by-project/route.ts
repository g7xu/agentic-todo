import { NextResponse } from "next/server";
import { requireUser, UnauthenticatedError } from "@/lib/auth/session";
import { getTimezone } from "@/lib/data/profile";
import { addDays, todayStr } from "@/lib/date";
import { getTimeByProject } from "@/lib/data/time-share";
import { clampHistoryDays } from "@/lib/validation/routines";

/**
 * Finished work by project for the Activity page (docs/TIME-BY-PROJECT.md).
 * Same window contract as GET /api/routines/history: it ends at the user's
 * local today and runs back `days` days, and reading it writes nothing.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const tz = await getTimezone(user.id);
    const to = todayStr(tz);

    const days = clampHistoryDays(new URL(req.url).searchParams.get("days"));
    const from = addDays(to, -(days - 1));

    const share = await getTimeByProject(user.id, from, to, tz);
    return NextResponse.json({ from, to, ...share });
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

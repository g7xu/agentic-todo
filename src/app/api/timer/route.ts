import { NextResponse } from "next/server";
import { requireUser, UnauthenticatedError } from "@/lib/auth/session";
import { getRunningTimer } from "@/lib/data/timers";
import type { TimerStateDTO } from "@/lib/types";

/**
 * The running timer, refetched on every focus. Kept apart from
 * `GET /api/tasks`, which records missed routine days on each read and is too
 * heavy to repeat that often (docs/TIMERS.md §3.4).
 */
export async function GET() {
  try {
    const user = await requireUser();
    const body: TimerStateDTO = {
      timer: await getRunningTimer(user.id),
      now: new Date().toISOString(),
    };
    return NextResponse.json(body);
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

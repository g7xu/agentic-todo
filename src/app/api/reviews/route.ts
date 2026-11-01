import { NextResponse } from "next/server";
import { requireUser, UnauthenticatedError } from "@/lib/auth/session";
import { getTimezone } from "@/lib/data/profile";
import { listReviews } from "@/lib/data/reviews";
import { startOfWeek, todayStr } from "@/lib/date";

/** Weeks that have a review, plus the current week so the list can lead with it. */
export async function GET() {
  try {
    const user = await requireUser();
    const tz = await getTimezone(user.id);
    return NextResponse.json({
      thisWeek: startOfWeek(todayStr(tz)),
      reviews: await listReviews(user.id),
    });
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

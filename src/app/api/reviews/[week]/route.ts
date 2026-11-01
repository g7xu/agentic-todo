import { NextResponse, type NextRequest } from "next/server";
import { requireUser, UnauthenticatedError } from "@/lib/auth/session";
import { getTimezone } from "@/lib/data/profile";
import { getReview, listCompletedBetween } from "@/lib/data/reviews";
import { addDays, startOfWeek, todayStr } from "@/lib/date";
import { weekSchema } from "@/lib/validation/reviews";

/**
 * One week's board: its review (null until the first note) and the one-off
 * tasks completed that week. Reading never creates a review.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/reviews/[week]">) {
  try {
    const user = await requireUser();
    const parsed = weekSchema.safeParse((await ctx.params).week);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid week" }, { status: 400 });
    }
    const week = parsed.data;
    const tz = await getTimezone(user.id);
    const [review, completed] = await Promise.all([
      getReview(user.id, week),
      listCompletedBetween(user.id, week, addDays(week, 6), tz),
    ]);
    return NextResponse.json({
      week,
      thisWeek: startOfWeek(todayStr(tz)),
      review,
      completed,
    });
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

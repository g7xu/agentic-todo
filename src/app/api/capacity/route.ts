import { NextResponse } from "next/server";
import { requireUser, UnauthenticatedError } from "@/lib/auth/session";
import { getCapacity } from "@/lib/data/capacity";
import { getTimezone } from "@/lib/data/profile";
import { todayStr } from "@/lib/date";

export async function GET() {
  try {
    const user = await requireUser();
    const today = todayStr(await getTimezone(user.id));
    return NextResponse.json(await getCapacity(user.id, today));
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

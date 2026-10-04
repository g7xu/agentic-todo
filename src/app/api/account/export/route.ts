import { NextResponse } from "next/server";
import { requireUser, UnauthenticatedError } from "@/lib/auth/session";
import { exportAccount } from "@/lib/data/account";
import { getTimezone } from "@/lib/data/profile";
import { todayStr } from "@/lib/date";

/** Downloads everything the user owns as one JSON file. */
export async function GET() {
  try {
    const user = await requireUser();
    const [data, timezone] = await Promise.all([
      exportAccount(user.id),
      getTimezone(user.id),
    ]);
    const filename = `agentictodo-export-${todayStr(timezone)}.json`;

    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

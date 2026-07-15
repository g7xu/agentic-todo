import { NextResponse } from "next/server";
import { requireUser, UnauthenticatedError } from "@/lib/auth/session";
import { listRoutines } from "@/lib/data/routines";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ routines: await listRoutines(user.id) });
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

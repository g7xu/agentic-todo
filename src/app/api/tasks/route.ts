import { NextResponse } from "next/server";
import { requireUser, UnauthenticatedError } from "@/lib/auth/session";
import { listTasks } from "@/lib/data/tasks";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ tasks: await listTasks(user.id) });
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

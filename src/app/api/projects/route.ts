import { NextResponse } from "next/server";
import { requireUser, UnauthenticatedError } from "@/lib/auth/session";
import { listProjects } from "@/lib/data/projects";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ projects: await listProjects(user.id) });
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

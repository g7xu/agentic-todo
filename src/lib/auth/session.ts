import { auth } from "@/lib/auth/server";

export class UnauthenticatedError extends Error {
  constructor() {
    super("UNAUTHENTICATED");
    this.name = "UnauthenticatedError";
  }
}

/**
 * Resolve the authenticated user on the server. Throws UnauthenticatedError
 * when there is no session — server actions and route handlers translate that
 * into a redirect / 401. The returned id is the only source of `userId` for all
 * data-layer scoping (TDD §7); it is never taken from client input.
 */
export async function requireUser(): Promise<{ id: string; email: string }> {
  const { data: session } = await auth.getSession();
  if (!session?.user) throw new UnauthenticatedError();
  return { id: session.user.id, email: session.user.email ?? "" };
}

import { prisma } from "@/lib/db";

/**
 * Idempotent, app-layer user provisioning (TDD §3 — replaces the Supabase
 * `auth.users` trigger). Call on the first authenticated request (Phase 2),
 * passing the Neon Auth (Better Auth) user id + email from `auth.getSession()`.
 *
 * Ensures the user has exactly one `Profile` (timezone defaults to "UTC",
 * `tzCaptured` false) and one default **Inbox** project. Safe to call on every
 * request and under concurrent first requests: the `Profile` PK and the partial
 * unique index `projects(user_id) WHERE is_inbox` make duplicate inserts fail
 * with P2002, which we swallow.
 */
export async function ensureUserProvisioned(
  userId: string,
  email: string,
): Promise<void> {
  try {
    await prisma.profile.upsert({
      where: { id: userId },
      update: { email },
      create: { id: userId, email },
    });
  } catch (e) {
    // A concurrent first request may have created the profile between our
    // upsert's read and write — ignore the unique-violation, rethrow anything else.
    if (!isUniqueViolation(e)) throw e;
  }

  const inbox = await prisma.project.findFirst({
    where: { userId, isInbox: true },
    select: { id: true },
  });
  if (inbox) return;

  try {
    await prisma.project.create({
      data: { userId, name: "Inbox", isInbox: true },
    });
  } catch (e) {
    // Lost the race to create the Inbox — the partial unique index rejected the
    // second insert. That's the desired outcome, so swallow it.
    if (!isUniqueViolation(e)) throw e;
  }
}

/** True for a Prisma unique-constraint violation (error code P2002). */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: unknown }).code === "P2002"
  );
}

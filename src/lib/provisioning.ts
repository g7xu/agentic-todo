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

/**
 * `ensureUserProvisioned` for a user read from a session, which can outlive
 * its account: session data is cached in a cookie, so for a few minutes
 * after `deleteAccount` a request may still carry the deleted user's id.
 * Returns false, creating nothing, when the Neon Auth user no longer exists.
 */
export async function provisionSessionUser(
  userId: string,
  email: string,
): Promise<boolean> {
  const [{ exists }] = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM neon_auth."user" WHERE id = ${userId}::uuid) AS exists`;
  if (!exists) return false;
  await ensureUserProvisioned(userId, email);
  return true;
}

/** True for a Prisma unique-constraint violation (error code P2002). */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: unknown }).code === "P2002"
  );
}

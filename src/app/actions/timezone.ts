"use server";

import { auth } from "@/lib/auth/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { isValidTimeZone } from "@/lib/date";

/**
 * Persist the browser timezone to the signed-in user's Profile and mark it
 * captured (TDD §5 / PRD F1). Scoped to the session user — the id is never
 * taken from client input.
 */
export async function captureTimezone(timezone: string): Promise<void> {
  const { data: session } = await auth.getSession();
  if (!session?.user) return;

  // Reject anything that isn't a valid IANA zone so we never store garbage.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return;
  }

  await prisma.profile.update({
    where: { id: session.user.id },
    data: { timezone, tzCaptured: true },
  });
}

/**
 * Settings page: explicitly change the user's timezone (PRD F1 / D1). Returns
 * the saved value so the client can update its tz context and invalidate
 * ['tasks'] to recompute "today".
 */
export async function updateTimezoneAction(timezone: string): Promise<string> {
  const user = await requireUser();
  if (!isValidTimeZone(timezone)) throw new Error("Invalid timezone");
  await prisma.profile.update({
    where: { id: user.id },
    data: { timezone, tzCaptured: true },
  });
  return timezone;
}

import { prisma } from "@/lib/db";

/**
 * The user's IANA zone, the single source of truth for "today" (TDD §5).
 * UTC when the profile has not been provisioned yet.
 */
export async function getTimezone(userId: string): Promise<string> {
  const profile = await prisma.profile.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  return profile?.timezone ?? "UTC";
}

import { prisma } from "@/lib/db";
import { dbDateToStr, toDbDate } from "@/lib/date";
import type { CapacityDTO } from "@/lib/types";

/** The default plus every override on or after `from` ('YYYY-MM-DD'). Past
 * overrides stay stored but no view reads them. */
export async function getCapacity(
  userId: string,
  from: string,
): Promise<CapacityDTO> {
  const [profile, rows] = await Promise.all([
    prisma.profile.findUnique({
      where: { id: userId },
      select: { dailyCapacity: true },
    }),
    prisma.dayCapacity.findMany({
      where: { userId, date: { gte: toDbDate(from) } },
      select: { date: true, minutes: true },
    }),
  ]);
  return {
    defaultMinutes: profile?.dailyCapacity ?? null,
    days: Object.fromEntries(rows.map((r) => [dbDateToStr(r.date)!, r.minutes])),
  };
}

export async function setDefaultCapacity(
  userId: string,
  minutes: number | null,
): Promise<void> {
  await prisma.profile.update({
    where: { id: userId },
    data: { dailyCapacity: minutes },
  });
}

/** Null removes the override, returning the day to the default (DC2). */
export async function setDayCapacity(
  userId: string,
  date: string,
  minutes: number | null,
): Promise<void> {
  const key = { userId, date: toDbDate(date) };
  if (minutes === null) {
    await prisma.dayCapacity.deleteMany({ where: key });
    return;
  }
  await prisma.dayCapacity.upsert({
    where: { userId_date: key },
    create: { ...key, minutes },
    update: { minutes },
  });
}

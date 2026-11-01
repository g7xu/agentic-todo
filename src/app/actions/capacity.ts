"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { setDayCapacity, setDefaultCapacity } from "@/lib/data/capacity";
import { dateStr } from "@/lib/validation/tasks";

/** 0 (a day off) to 24h, the same ceiling as an estimate. */
const minutesSchema = z.number().int().min(0).max(1440).nullable();

export async function setDefaultCapacityAction(
  minutes: number | null,
): Promise<void> {
  const user = await requireUser();
  await setDefaultCapacity(user.id, minutesSchema.parse(minutes));
}

export async function setDayCapacityAction(
  date: string,
  minutes: number | null,
): Promise<void> {
  const user = await requireUser();
  await setDayCapacity(user.id, dateStr.parse(date), minutesSchema.parse(minutes));
}

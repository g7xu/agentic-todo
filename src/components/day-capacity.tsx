"use client";

import { cn } from "@/lib/utils";
import { availableOn, CAPACITY_PRESETS, dayLoad } from "@/lib/capacity";
import { formatDuration } from "@/lib/duration";
import { useSetDayCapacity } from "@/hooks/use-capacity";
import { DurationPicker } from "@/components/duration-picker";
import { PlannedTotal } from "@/components/planned-total";
import type { CapacityDTO } from "@/lib/types";

/** A single day can be taken off entirely, which the default can't usefully be. */
const DAY_PRESETS = [0, ...CAPACITY_PRESETS];

/**
 * A day column's budget (docs/CAPACITY.md §2): a done / planned / free bar over
 * "3h free of 6h", where the text opens the menu that sets this one day. A day
 * with no capacity at all keeps the plain planned total (DC1), with the menu
 * behind a "Set time" link that only shows on hover.
 */
export function DayCapacity({
  date,
  capacity,
  open,
  completed,
}: {
  date: string;
  capacity: CapacityDTO;
  /** Active tasks and routine occurrences in the column. */
  open: { estimate: number | null }[];
  completed: { estimate: number | null; timeUsed: number | null }[];
}) {
  const setDay = useSetDayCapacity();
  const override = date in capacity.days ? capacity.days[date] : null;
  const load = dayLoad(availableOn(date, capacity), open, completed);

  const picker = (trigger: React.ReactElement) => (
    <DurationPicker
      value={override}
      onChange={(minutes) => {
        // Closing the menu commits even when nothing was picked.
        if (minutes !== override) setDay.mutate({ date, minutes });
      }}
      presets={DAY_PRESETS}
      clearLabel={
        capacity.defaultMinutes === null
          ? "Clear"
          : `Use default (${formatDuration(capacity.defaultMinutes)})`
      }
      trigger={trigger}
    />
  );

  if (load.available === null || load.free === null) {
    return (
      <div className="flex items-center gap-2">
        <PlannedTotal items={open} />
        {picker(
          <button
            type="button"
            className="hover:text-foreground focus:opacity-100 data-[state=open]:opacity-100 md:opacity-0 md:group-hover/header:opacity-100"
          >
            Set time
          </button>,
        )}
      </div>
    );
  }

  const { available, done, planned, free, unestimated } = load;
  const over = free < 0;
  // Over budget, the bar is scaled to the load so the overflow stays visible
  // as the share of the fill that is red.
  const scale = Math.max(available, done + planned) || 1;
  const pct = (m: number) => `${(m / scale) * 100}%`;

  const label = over
    ? available === 0
      ? `${formatDuration(-free)} on a day off`
      : `${formatDuration(-free)} over ${formatDuration(available)}`
    : available === 0
      ? "Day off"
      : `${formatDuration(free)} free of ${formatDuration(available)}`;
  const breakdown = [
    `${available === 0 ? "Day off" : `${formatDuration(available)} available`} (${override === null ? "default" : "set for this day"})`,
    `${formatDuration(done)} done`,
    `~${formatDuration(planned)} planned`,
  ].join(" · ");

  return (
    <div className="flex w-full flex-col gap-1">
      <div aria-hidden className="bg-muted flex h-1.5 w-full overflow-hidden rounded-full">
        <div
          className={over ? "bg-red-500/50" : "bg-muted-foreground/40"}
          style={{ width: pct(done) }}
        />
        <div
          className={over ? "bg-red-500" : "bg-primary"}
          style={{ width: pct(planned) }}
        />
      </div>
      <div className="flex items-center gap-1 tabular-nums">
        {picker(
          <button
            type="button"
            className={cn(
              "hover:text-foreground hover:underline",
              over && "text-red-500",
            )}
            title={breakdown}
            // Without this the title becomes the name and the visible label
            // is never announced.
            aria-label={`${label}. ${breakdown}`}
          >
            {label}
          </button>,
        )}
        {unestimated > 0 && <span>· {unestimated} unestimated</span>}
      </div>
    </div>
  );
}

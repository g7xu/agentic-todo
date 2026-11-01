"use client";

import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { DurationPicker } from "@/components/duration-picker";
import { useCapacity, useSetDefaultCapacity } from "@/hooks/use-capacity";
import { CAPACITY_PRESETS } from "@/lib/capacity";

export function CapacityForm() {
  const { data, isPending, isError } = useCapacity();
  const setDefault = useSetDefaultCapacity();

  return (
    <div className="grid max-w-sm gap-2">
      {isPending ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : isError ? (
        <p className="text-destructive text-sm">Couldn’t load available time.</p>
      ) : (
        <div className="w-40">
          <DurationPicker
            value={data.defaultMinutes}
            onChange={(minutes) => {
              if (minutes === data.defaultMinutes) return;
              setDefault.mutate(minutes, {
                onSuccess: () => toast("Available time updated"),
              });
            }}
            placeholder="Not set"
            icon={CalendarClock}
            presets={CAPACITY_PRESETS}
            clearLabel="Clear available time"
            fullWidth
          />
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        How much working time a day has. Each Upcoming column subtracts its
        tasks’ estimates from it; change a single day from its column header.
      </p>
    </div>
  );
}

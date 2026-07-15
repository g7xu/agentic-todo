"use client";

import { Repeat } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useTimezone } from "@/components/timezone-context";
import { addDays, todayStr } from "@/lib/date";
import { useCompleteTask, useTasks } from "@/hooks/use-tasks";

/**
 * "Yesterday: N missed — done any of these?" strip for the Today view
 * (docs/ROUTINES.md §2). Checking an item backfills it (missed → completed,
 * original dueDate kept). Misses older than the fetched two-day window are
 * the assistant's job, not the UI's. Renders nothing when there are no
 * recent misses.
 */
export function RoutineRecap() {
  const tz = useTimezone();
  const today = todayStr(tz);
  const yesterday = addDays(today, -1);
  const { data: tasks = [] } = useTasks();
  const complete = useCompleteTask();

  const missed = tasks
    .filter((t) => t.status === "missed" && t.dueDate !== null)
    .sort((a, b) => b.dueDate!.localeCompare(a.dueDate!));
  if (missed.length === 0) return null;

  const yesterdayCount = missed.filter((t) => t.dueDate === yesterday).length;

  return (
    <div className="mb-4 overflow-hidden rounded-lg border">
      <div className="text-muted-foreground bg-muted/40 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium tracking-wide uppercase">
        <Repeat className="size-3" />
        {yesterdayCount === missed.length
          ? `Yesterday: ${missed.length} missed`
          : `Recently missed: ${missed.length}`}
        <span className="normal-case tracking-normal">
          — done any of these?
        </span>
      </div>
      {missed.map((t) => (
        <div
          key={t.id}
          className="hover:bg-accent/40 flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
        >
          <Checkbox
            checked={false}
            aria-label={`Mark "${t.content}" done`}
            onCheckedChange={(checked) => {
              if (checked) complete.mutate(t.id);
            }}
          />
          <span className="flex-1 truncate text-sm">{t.content}</span>
          <span className="text-muted-foreground text-xs">
            {t.dueDate === yesterday ? "Yesterday" : t.dueDate}
          </span>
        </div>
      ))}
    </div>
  );
}

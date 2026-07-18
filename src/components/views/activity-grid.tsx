"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useTimezone } from "@/components/timezone-context";
import { addDays, todayStr } from "@/lib/date";
import { cadenceLabel, occurrencesBetween } from "@/lib/repeat";
import { useRoutineHistory, useRoutines } from "@/hooks/use-routines";
import { Button } from "@/components/ui/button";

/**
 * What one routine did on one day (docs/ROUTINES.md §RV8).
 *
 * 'norecord' is the state that keeps this grid honest: the day was on the
 * cadence, but nothing was ever written for it, because materialization only
 * runs when the app is opened (§DR2). It is NOT a miss and must not be drawn
 * as one — an unopened week would otherwise read as a week of failure.
 */
type Cell = "done" | "missed" | "norecord" | "notdue";

const WINDOWS = [
  { days: 84, label: "12 weeks" },
  { days: 364, label: "1 year" },
];

const CELL_CLASS: Record<Cell, string> = {
  done: "bg-teal-600 dark:bg-teal-500",
  missed: "bg-red-400/80 dark:bg-red-500/70",
  // Outlined, not filled — reads as "nothing here", vs notdue's "nothing due".
  norecord: "bg-transparent ring-1 ring-inset ring-muted-foreground/35",
  notdue: "bg-muted",
};

const CELL_LABEL: Record<Cell, string> = {
  done: "done",
  missed: "missed",
  norecord: "no record",
  notdue: "not due",
};

function monthLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function ActivityGrid() {
  const tz = useTimezone();
  const today = todayStr(tz);
  const [windowDays, setWindowDays] = useState(84);

  const { data: routines = [], isLoading: loadingRoutines } = useRoutines();
  const { data: history, isLoading: loadingHistory } =
    useRoutineHistory(windowDays);

  const dates = useMemo(
    () =>
      Array.from({ length: windowDays }, (_, i) =>
        addDays(today, -(windowDays - 1 - i)),
      ),
    [today, windowDays],
  );

  // routineId|date -> recorded status. Everything else is derived.
  const recorded = useMemo(() => {
    const m = new Map<string, "completed" | "missed">();
    for (const d of history?.days ?? []) m.set(`${d.routineId}|${d.date}`, d.status);
    return m;
  }, [history]);

  const rows = useMemo(() => {
    return routines.map((r) => {
      // Completed-based routines have no computable future/past grid — their
      // cadence measures from each completion — so `occurrencesBetween`
      // returns nothing and every day is 'notdue' unless something was
      // actually recorded. No streak is claimed for them (§RV5).
      const dueSet = new Set(
        occurrencesBetween(r, dates[0], dates[dates.length - 1]),
      );
      const openEnded = r.repeatBase === "completed";

      const cells: Cell[] = dates.map((d) => {
        const rec = recorded.get(`${r.id}|${d}`);
        if (rec === "completed") return "done";
        if (rec === "missed") return "missed";
        if (!dueSet.has(d)) return "notdue";
        // Due, nothing written. Today's instance is still open, not a gap.
        return d === today ? "notdue" : "norecord";
      });

      let done = 0;
      let counted = 0;
      for (const c of cells) {
        if (c === "done" || c === "missed") counted++;
        if (c === "done") done++;
      }

      // Streak walks back from today and stops at a miss — and at a
      // 'norecord' too, because an unknown day can't be claimed as a win.
      let streak = 0;
      for (let i = cells.length - 1; i >= 0; i--) {
        if (cells[i] === "done") streak++;
        else if (cells[i] === "missed" || cells[i] === "norecord") break;
      }

      return { routine: r, cells, done, counted, streak, openEnded };
    });
  }, [routines, dates, recorded, today]);

  // Aggregate strip: share of each day's due routines that were completed.
  const summary = useMemo(() => {
    return dates.map((_, i) => {
      let due = 0;
      let done = 0;
      let gap = 0;
      for (const row of rows) {
        const c = row.cells[i];
        if (c === "done" || c === "missed") due++;
        if (c === "done") done++;
        if (c === "norecord") gap++;
      }
      return { due, done, gap };
    });
  }, [rows, dates]);

  // Open on the most recent day. The grid is far wider than the viewport and
  // scrolls from the left by default, which would land the user three months
  // in the past — the one stretch of a history view nobody opens it for.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [windowDays, rows.length, history]);

  const loading = loadingRoutines || loadingHistory;

  if (!loading && routines.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No routines yet. Create one and this fills in as you go.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="text-muted-foreground text-sm">
          {loading ? "Loading…" : `Ending ${dayLabel(today)}`}
        </div>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <Button
              key={w.days}
              size="sm"
              variant={w.days === windowDays ? "secondary" : "ghost"}
              onClick={() => setWindowDays(w.days)}
            >
              {w.label}
            </Button>
          ))}
        </div>
      </div>

      <div ref={scroller} className="overflow-x-auto pb-2">
        <div className="min-w-min">
          {/* Aggregate strip, aligned to the same columns as the rows below so
              a vertical scan lines up across both. */}
          <div className="mb-1 flex gap-[3px] pl-[164px]">
            {summary.map((s, i) => {
              const share = s.due > 0 ? s.done / s.due : null;
              const cls =
                share === null
                  ? s.gap > 0
                    ? CELL_CLASS.norecord
                    : CELL_CLASS.notdue
                  : share === 0
                    ? CELL_CLASS.missed
                    : share < 0.5
                      ? "bg-teal-600/30 dark:bg-teal-500/30"
                      : share < 1
                        ? "bg-teal-600/60 dark:bg-teal-500/60"
                        : CELL_CLASS.done;
              return (
                <div
                  key={dates[i]}
                  title={
                    s.due > 0
                      ? `${dayLabel(dates[i])} — ${s.done} of ${s.due} done`
                      : `${dayLabel(dates[i])} — ${s.gap > 0 ? "no record" : "nothing due"}`
                  }
                  className={cn("size-3 shrink-0 rounded-[2.5px]", cls)}
                />
              );
            })}
          </div>

          <div className="mb-2 flex gap-[3px] pl-[164px]">
            {dates.map((d, i) => {
              const first = i === 0 || monthLabel(d) !== monthLabel(dates[i - 1]);
              return (
                <div
                  key={d}
                  className="text-muted-foreground relative size-3 shrink-0 text-[10px]"
                >
                  {first && i < dates.length - 4 && (
                    <span className="absolute top-0 left-0 font-mono">
                      {monthLabel(d)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-[3px]">
            {rows.map(({ routine, cells, done, counted, streak, openEnded }) => (
              <div key={routine.id} className="flex items-center gap-[3px]">
                <div className="bg-background sticky left-0 z-10 w-[164px] shrink-0 pr-3">
                  <div className="truncate text-[13px] font-medium">
                    {routine.content}
                  </div>
                  <div className="text-muted-foreground truncate font-mono text-[10px]">
                    {cadenceLabel(routine)}
                  </div>
                </div>
                {cells.map((c, i) => (
                  <div
                    key={dates[i]}
                    title={`${routine.content} · ${dayLabel(dates[i])} — ${CELL_LABEL[c]}`}
                    className={cn(
                      "size-3 shrink-0 rounded-[2.5px]",
                      CELL_CLASS[c],
                    )}
                  />
                ))}
                <div className="text-muted-foreground ml-3 shrink-0 font-mono text-[11px] tabular-nums whitespace-nowrap">
                  {openEnded
                    ? `${done} done`
                    : counted > 0
                      ? `${Math.round((done / counted) * 100)}% · ${streak}d`
                      : "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
        {(["done", "missed", "norecord", "notdue"] as Cell[]).map((c) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className={cn("size-3 rounded-[2.5px]", CELL_CLASS[c])} />
            {CELL_LABEL[c] === "no record" ? "No record" : CELL_LABEL[c]}
          </span>
        ))}
      </div>

      {rows.some((r) => r.cells.includes("norecord")) && (
        <p className="text-muted-foreground max-w-prose text-xs">
          <strong className="text-foreground">No record</strong> means the day
          was on the routine&rsquo;s schedule but nothing was ever written for
          it — the app only records a day when you open it. Those days are not
          counted as misses, and they stop a streak rather than breaking it.
        </p>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useTimezone } from "@/components/timezone-context";
import { addDays, todayStr, weekdayOf } from "@/lib/date";
import { cadenceLabel, occurrencesBetween } from "@/lib/repeat";
import { toast } from "sonner";
import {
  useRoutineHistory,
  useRoutines,
  useSetRoutineDay,
} from "@/hooks/use-routines";
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

/**
 * Days are laid out as calendar columns — one column per week, seven rows for
 * the weekdays — rather than one long strip. A strip costs 15px per day, so a
 * year ran ~5,500px wide and every routine had to be scrolled to. Folded into
 * weeks the same year is ~800px and fits the page.
 */
const CELL = 12; // px; matches size-3
const GAP = 3;
const COL = CELL + GAP;
const WEEKDAY_COL = 16; // left gutter holding the M/W/F labels

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

/** What clicking a cell asserts, and what undoing it restores. 'notdue' is
 * absent: there is nothing to claim about a day the routine wasn't due. */
const NEXT_STATUS: Partial<Record<Cell, "completed" | "missed">> = {
  missed: "completed",
  norecord: "completed",
  done: "missed",
};

/** Restoring a cell to what it was. Note 'done' maps to the API's
 * 'completed', and 'norecord' to 'clear' — a cell that had no row goes back
 * to having none, rather than being left as a 'missed' we invented. */
const UNDO_STATUS: Partial<Record<Cell, "completed" | "missed" | "clear">> = {
  done: "completed",
  missed: "missed",
  norecord: "clear",
};

/** Sun-first, so the row index is `weekdayOf` unchanged. Only alternate rows
 * are labelled — three 9px letters is as much as a 12px row pitch can carry. */
const WEEKDAY_LABELS = ["", "M", "", "W", "", "F", ""];

/**
 * The calendar frame: a column of weekday letters, a row of month labels, and
 * the week columns themselves. `leadingPad` blanks the days before the window
 * started so the first column still lands on the right weekday row.
 */
function CalendarGrid({
  dates,
  leadingPad,
  weeks,
  renderCell,
}: {
  dates: string[];
  leadingPad: number;
  weeks: number;
  renderCell: (index: number) => ReactNode;
}) {
  // The date a given week column starts on, clamped for the padded first one.
  const weekStart = (w: number) => dates[Math.max(0, w * 7 - leadingPad)];

  return (
    <div className="flex gap-1">
      <div
        className="text-muted-foreground grid shrink-0 text-[9px] leading-none"
        style={{
          width: WEEKDAY_COL,
          gridTemplateRows: `repeat(7, ${CELL}px)`,
          gap: GAP,
        }}
      >
        {WEEKDAY_LABELS.map((l, i) => (
          <span key={i} className="flex items-center">
            {l}
          </span>
        ))}
      </div>

      <div className="flex flex-col" style={{ gap: GAP }}>
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${weeks}, ${CELL}px)`,
            gap: GAP,
            height: CELL,
          }}
        >
          {Array.from({ length: weeks }, (_, w) => {
            const d = weekStart(w);
            // A label marks the column where a new month begins. The last two
            // columns are skipped: the text is wider than its column and would
            // spill past the right edge with nothing to spill into.
            const isNew = w === 0 || monthLabel(d) !== monthLabel(weekStart(w - 1));
            return (
              <div
                key={d}
                className="text-muted-foreground relative text-[10px] leading-none"
              >
                {isNew && w < weeks - 2 && (
                  <span className="absolute top-0 left-0 font-mono">
                    {monthLabel(d)}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Explicit rows + column flow means auto-placement fills each week
            top-to-bottom before moving right, which is what makes this read
            as a calendar. */}
        <div
          className="grid grid-flow-col"
          style={{
            gridTemplateRows: `repeat(7, ${CELL}px)`,
            gridTemplateColumns: `repeat(${weeks}, ${CELL}px)`,
            gap: GAP,
          }}
        >
          {Array.from({ length: leadingPad }, (_, i) => (
            <div key={`pad-${i}`} />
          ))}
          {dates.map((_, i) => renderCell(i))}
        </div>
      </div>
    </div>
  );
}

export function ActivityGrid() {
  const tz = useTimezone();
  const today = todayStr(tz);
  const [windowDays, setWindowDays] = useState(84);
  const setDay = useSetRoutineDay();

  // Undo restores the cell to what it was. A cell that had no row at all goes
  // back to having none — 'clear' — rather than being left as a fabricated
  // 'missed', which would be a different claim than the one we started with.
  function correct(routineId: string, date: string, from: Cell, name: string) {
    const to = NEXT_STATUS[from];
    const back = UNDO_STATUS[from];
    if (!to || !back) return;
    setDay.mutate(
      { routineId, date, status: to },
      {
        onSuccess: () =>
          toast(`${name} · ${dayLabel(date)} marked ${to}`, {
            action: {
              label: "Undo",
              onClick: () => setDay.mutate({ routineId, date, status: back }),
            },
          }),
      },
    );
  }

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

  // Where the window's first day sits in its week, and how many columns that
  // makes. Both drive every grid on the page, so they're computed once.
  const leadingPad = weekdayOf(dates[0]);
  const weeks = Math.ceil((leadingPad + windowDays) / 7);
  const gridWidth = weeks * COL - GAP;
  // Cards are fixed-width so they tile predictably: 12 weeks gives ~4 per row,
  // a year gives one. Padding (24) + border (2) + gutter (16) + its gap (4).
  const cardWidth = gridWidth + WEEKDAY_COL + 4 + 26;

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

  // Aggregate calendar: share of each day's due routines that were completed.
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

  // A year of columns is wider than a phone. Nothing scrolls on a laptop, but
  // when it does, open at the most recent week rather than a year ago.
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
          {loading
            ? "Loading…"
            : `Ending ${dayLabel(today)} · click any day to correct it`}
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

      <div ref={scroller} className="overflow-x-auto pb-1">
        <div className="rounded-lg border p-3" style={{ width: cardWidth }}>
          <div className="mb-2 text-[13px] font-medium">All routines</div>
          <CalendarGrid
            dates={dates}
            leadingPad={leadingPad}
            weeks={weeks}
            renderCell={(i) => {
              const s = summary[i];
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
                  className={cn("rounded-[2.5px]", cls)}
                />
              );
            }}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-3">
          {rows.map(({ routine, cells, done, counted, streak, openEnded }) => (
            <div
              key={routine.id}
              className="rounded-lg border p-3"
              style={{ width: cardWidth }}
            >
              <div className="mb-0.5 flex items-center gap-1">
                {/* Without this a paused routine reads as one that was simply
                    abandoned — trailing off into empty cells looks like
                    failure rather than a deliberate choice. An ended routine
                    already says so via its cadence label ("… until Jul 8");
                    paused had no equivalent. */}
                {!routine.active && (
                  <span
                    title="Paused — no new instances spawn, and days after pausing are not recorded"
                    className="border-muted-foreground/30 text-muted-foreground shrink-0 rounded border px-1 font-mono text-[10px] tracking-wide uppercase"
                  >
                    paused
                  </span>
                )}
                <div className="truncate text-[13px] font-medium">
                  {routine.content}
                </div>
              </div>
              <div className="text-muted-foreground mb-2 flex items-baseline justify-between gap-2 font-mono text-[10px]">
                <span className="truncate">{cadenceLabel(routine)}</span>
                {/* Streak counts consecutive OCCURRENCES, not days — a weekly
                    routine done twice running is a streak of 2, though eight
                    days separate them. Hence '×2' rather than '2d'. */}
                <span
                  className="shrink-0 tabular-nums"
                  title={
                    openEnded
                      ? `${done} completions recorded`
                      : `${done} of ${counted} recorded days done · ${streak} in a row`
                  }
                >
                  {openEnded
                    ? `${done} done`
                    : counted > 0
                      ? `${Math.round((done / counted) * 100)}% · ×${streak}`
                      : "—"}
                </span>
              </div>

              <CalendarGrid
                dates={dates}
                leadingPad={leadingPad}
                weeks={weeks}
                renderCell={(i) => {
                  const c = cells[i];
                  const base = cn("rounded-[2.5px]", CELL_CLASS[c]);
                  const label = `${routine.content} · ${dayLabel(dates[i])} — ${CELL_LABEL[c]}`;
                  // 'not due' days assert nothing, so they stay inert divs —
                  // which also keeps hundreds of empty cells out of the tab
                  // order.
                  if (!NEXT_STATUS[c]) {
                    return <div key={dates[i]} title={label} className={base} />;
                  }
                  return (
                    <button
                      key={dates[i]}
                      type="button"
                      disabled={setDay.isPending}
                      title={`${label} · click to mark ${NEXT_STATUS[c]}`}
                      aria-label={label}
                      onClick={() =>
                        correct(routine.id, dates[i], c, routine.content)
                      }
                      className={cn(
                        base,
                        "hover:ring-foreground/40 cursor-pointer hover:ring-2 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-default",
                      )}
                    />
                  );
                }}
              />
            </div>
          ))}
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

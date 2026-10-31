"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  formatHours,
  MIN_TASKS,
  ON_PLAN,
  onPlan,
  type ProjectAccuracy,
} from "@/lib/estimate-accuracy";
import { useProjects } from "@/hooks/use-projects";
import { useEstimateVsActual } from "@/hooks/use-tasks";
import { Button } from "@/components/ui/button";

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 28, label: "4 weeks" },
  { days: 84, label: "12 weeks" },
];

/** Hour steps an axis may tick at, in minutes. The first that leaves at most
 * three ticks inside the longest bar wins. */
const TICK_STEPS = [15, 30, 60, 120, 300, 600, 1200, 3000, 6000];

function ticksFor(max: number): number[] {
  const step = TICK_STEPS.find((s) => max / s <= 3) ?? TICK_STEPS.at(-1)!;
  const ticks: number[] = [];
  for (let t = step; t < max; t += step) ticks.push(t);
  return ticks;
}

function pct(minutes: number, max: number): string {
  return `${(minutes / max) * 100}%`;
}

/**
 * One planned-vs-logged pair on the shared axis. The planned bar is the track;
 * logged time fills it from the same baseline. Logged time past the estimate
 * continues in amber; an estimate logged time never reached stays visible as a
 * blue-tinted remainder of the track.
 */
function PlanBar({
  estimate,
  used,
  max,
  ticks,
  thick,
}: {
  estimate: number;
  used: number;
  max: number;
  ticks: number[];
  thick: boolean;
}) {
  const over = used > estimate;
  const under = used < estimate;
  return (
    <div className={cn("relative w-full", thick ? "h-4" : "h-2")}>
      {ticks.map((t) => (
        <span
          key={t}
          aria-hidden
          className="bg-border absolute inset-y-0 w-px"
          style={{ left: pct(t, max) }}
        />
      ))}
      <div
        className={cn(
          "absolute inset-y-0 left-0 rounded-r ring-1 ring-inset",
          under
            ? "bg-sky-500/15 ring-sky-500/30"
            : "bg-muted ring-border",
        )}
        style={{ width: pct(estimate, max) }}
      />
      <div
        className={cn(
          "bg-muted-foreground/60 absolute inset-y-0 left-0",
          !over && "rounded-r",
        )}
        style={{ width: pct(Math.min(used, estimate), max) }}
      />
      {over && (
        <div
          className="absolute inset-y-0 rounded-r bg-amber-600 dark:bg-amber-500"
          style={{ left: pct(estimate, max), width: pct(used - estimate, max) }}
        />
      )}
    </div>
  );
}

function headline(rows: ProjectAccuracy[], name: (id: string) => string) {
  const judged = rows.filter((r) => r.tasks >= MIN_TASKS);
  if (judged.length === 0) {
    return `No project has ${MIN_TASKS} timed tasks in this window yet.`;
  }
  const off = judged
    .filter((r) => !onPlan(r))
    .sort(
      (a, b) =>
        Math.abs(b.usedMinutes - b.estimatedMinutes) -
        Math.abs(a.usedMinutes - a.estimatedMinutes),
    )
    .slice(0, 2);
  if (off.length === 0) {
    return `Every project with ${MIN_TASKS} or more timed tasks landed within ${ON_PLAN * 100}% of its plan.`;
  }
  return (
    off
      .map((r) => {
        const gap = formatHours(Math.abs(r.usedMinutes - r.estimatedMinutes));
        const dir = r.usedMinutes > r.estimatedMinutes ? "over" : "under";
        return `${name(r.projectId)} ran ${gap} ${dir} its plan`;
      })
      .join("; ") + "."
  );
}

/**
 * Planned hours against logged hours, per project (docs/ESTIMATE-VS-ACTUAL.md).
 * Every bar shares one hours axis so a project's size is honest next to the
 * others. Projects with fewer than MIN_TASKS compared tasks are drawn faded
 * and say "too few" (EA5); projects with enough get their biggest miss on a
 * second, thinner bar beneath, so the task behind a gap is named rather than
 * hidden in the total.
 */
export function EstimateVsActual() {
  const [days, setDays] = useState(84);
  const { data, isLoading, isError } = useEstimateVsActual(days);
  const { data: projects = [] } = useProjects();

  // Names come from the projects list, so a rename shows without a refetch:
  // renaming invalidates only the projects query.
  const names = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );
  const name = (id: string) => names.get(id) ?? "Deleted project";

  const rows = useMemo(() => data?.projects ?? [], [data]);
  const max = Math.max(
    1,
    ...rows.map((r) => Math.max(r.estimatedMinutes, r.usedMinutes)),
  );
  const ticks = ticksFor(max);
  const untimed = projects
    .filter((p) => !rows.some((r) => r.projectId === p.id))
    .map((p) => p.name);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="text-muted-foreground text-sm">
          {isLoading
            ? "Loading…"
            : isError
              ? "Couldn't load estimate vs. actual."
              : rows.length > 0
                ? headline(rows, name)
                : data && data.done > 0
                  ? "No finished task in this window has both an estimate and time used."
                  : "Nothing completed in this window."}
        </div>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <Button
              key={w.days}
              size="sm"
              variant={w.days === days ? "secondary" : "ghost"}
              onClick={() => setDays(w.days)}
            >
              {w.label}
            </Button>
          ))}
        </div>
      </div>

      {rows.length > 0 && (
        <>
          <div className="text-muted-foreground flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="bg-muted ring-border inline-block h-2 w-3.5 rounded-r ring-1 ring-inset" />
              planned
            </span>
            <span className="flex items-center gap-1.5">
              <span className="bg-muted-foreground/60 inline-block h-2 w-3.5 rounded-r" />
              logged
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-3.5 rounded-r bg-amber-600 dark:bg-amber-500" />
              over plan
            </span>
          </div>

          <ul className="flex flex-col gap-4">
            {rows.map((r) => {
              const thin = r.tasks < MIN_TASKS;
              const miss = r.biggestMiss;
              return (
                <li
                  key={r.projectId}
                  className={cn("flex flex-col gap-1.5", thin && "opacity-50")}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm">
                      <span className="font-medium">{name(r.projectId)}</span>
                      <span className="text-muted-foreground text-xs">
                        {thin
                          ? ` · too few · ${r.tasks}`
                          : ` · ${r.tasks} tasks`}
                      </span>
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {formatHours(r.usedMinutes)} of{" "}
                      {formatHours(r.estimatedMinutes)}
                    </span>
                  </div>
                  <PlanBar
                    estimate={r.estimatedMinutes}
                    used={r.usedMinutes}
                    max={max}
                    ticks={ticks}
                    thick
                  />
                  {!thin && (
                    <div className="flex flex-col gap-1">
                      {/* Only the label is indented: the bar must stay on the
                          shared axis to be comparable with the row above. */}
                      <div className="text-muted-foreground flex items-baseline justify-between gap-3 pl-3 text-xs">
                        <span className="min-w-0 truncate">
                          ↳ biggest miss: {miss.content}
                          {miss.routine && " ↻"}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {formatHours(miss.timeUsed)} of{" "}
                          {formatHours(miss.estimate)}
                        </span>
                      </div>
                      <PlanBar
                        estimate={miss.estimate}
                        used={miss.timeUsed}
                        max={max}
                        ticks={ticks}
                        thick={false}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="text-muted-foreground relative h-3 text-[10px] tabular-nums">
            <span className="absolute left-0">0</span>
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute -translate-x-1/2"
                style={{ left: pct(t, max) }}
              >
                {formatHours(t)}
              </span>
            ))}
          </div>
        </>
      )}

      {data && rows.length > 0 && untimed.length > 0 && (
        <p className="text-muted-foreground text-xs">
          No timed tasks: {untimed.join(", ")}.
        </p>
      )}

      {data && data.done > 0 && (
        <p className="text-muted-foreground border-t pt-2 text-xs">
          Based on {data.timed} of {data.done} done tasks with an estimate and
          time used. Projects under {MIN_TASKS} timed tasks are faded;
          within {ON_PLAN * 100}% counts as on plan.
          {data.timed === 0 &&
            " Add time used when you finish a task and it shows here."}
        </p>
      )}
    </div>
  );
}

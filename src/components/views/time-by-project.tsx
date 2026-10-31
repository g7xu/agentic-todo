"use client";

import { useMemo, useState } from "react";
import { formatDuration } from "@/lib/duration";
import { useProjects } from "@/hooks/use-projects";
import { useTimeByProject } from "@/hooks/use-tasks";
import { Button } from "@/components/ui/button";

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 28, label: "4 weeks" },
  { days: 84, label: "12 weeks" },
];

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * Where finished work went, by project, over a rolling window ending today
 * (docs/TIME-BY-PROJECT.md). A ranked list with one bar per project rather
 * than a chart: one series, few rows, and it has to read at 343px.
 *
 * A project with tasks done but no estimates stays in the list with its count
 * and an empty bar. Hiding it would make the share look complete when it
 * isn't; every number here is a lower bound (docs/ESTIMATES.md DE5), and the
 * list says per row how much of it rests on estimates.
 */
export function TimeByProject() {
  const [days, setDays] = useState(28);
  const { data, isLoading, isError } = useTimeByProject(days);
  const { data: projects = [] } = useProjects();

  // Names come from the projects list rather than the response, so a rename
  // shows at once: renaming invalidates only the projects query.
  const names = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  const rows = data?.projects ?? [];
  const totals = data?.totals;
  const idle = useMemo(() => {
    const active = new Set(data?.projects.map((r) => r.projectId));
    return projects.filter((p) => !active.has(p.id)).map((p) => p.name);
  }, [projects, data]);

  const header = isLoading
    ? "Loading…"
    : isError
      ? "Couldn't load time by project."
      : totals && totals.tasks > 0
        ? `~${formatDuration(totals.estimatedMinutes)} estimated · ${totals.tasks} done` +
          (totals.unestimated > 0 ? ` · ${totals.unestimated} unestimated` : "")
        : "Nothing completed in this window.";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="text-muted-foreground text-sm">{header}</div>
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

      {totals && rows.length > 0 && (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const share =
              totals.estimatedMinutes > 0
                ? r.estimatedMinutes / totals.estimatedMinutes
                : null;
            const estimated = r.tasks - r.unestimated;
            const details = [
              `${r.tasks} done`,
              r.unestimated > 0 && `${r.unestimated} unestimated`,
              r.routineTasks > 0 &&
                `${r.routineTasks} from routines` +
                  (r.routineMinutes > 0
                    ? ` (~${formatDuration(r.routineMinutes)})`
                    : ""),
              r.withTimeUsed > 0 &&
                `${formatDuration(r.timeUsedMinutes)} logged on ${r.withTimeUsed}`,
            ].filter(Boolean);
            return (
              <li key={r.projectId} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium">
                    {names.get(r.projectId) ?? "Deleted project"}
                  </span>
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {estimated > 0 ? (
                      <>
                        ~{formatDuration(r.estimatedMinutes)}
                        {share !== null && ` · ${pct(share)}`}
                      </>
                    ) : (
                      "no estimates"
                    )}
                  </span>
                </div>
                <div
                  className="bg-muted h-2 w-full overflow-hidden rounded"
                  role="img"
                  aria-label={
                    share === null
                      ? "no estimated minutes"
                      : `${pct(share)} of estimated minutes`
                  }
                >
                  <div
                    className="bg-foreground/70 h-full rounded"
                    style={{ width: share === null ? 0 : `${share * 100}%` }}
                  />
                </div>
                <div className="text-muted-foreground text-xs">
                  {details.join(" · ")}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {totals && totals.tasks > 0 && totals.estimatedMinutes === 0 && (
        <p className="text-muted-foreground text-xs">
          Percentages appear once finished tasks carry estimates.
        </p>
      )}

      {totals && rows.length > 0 && idle.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Nothing completed: {idle.join(", ")}
        </p>
      )}
    </div>
  );
}

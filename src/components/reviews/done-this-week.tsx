"use client";

import { Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/duration";
import { useTimezone } from "@/components/timezone-context";
import { dateStrInTz } from "@/lib/date";
import { META_CHIP, META_ROW, PROJECT_CHIP } from "@/lib/task-meta";
import type { ProjectDTO, TaskDTO } from "@/lib/types";

function weekday(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}

/** The week's finished one-off tasks: what the notes on the board are about. */
export function DoneThisWeek({
  tasks,
  projects,
}: {
  tasks: TaskDTO[];
  projects: ProjectDTO[];
}) {
  const tz = useTimezone();
  return (
    <aside className="w-full shrink-0 2xl:w-72">
      <h2 className="text-muted-foreground mb-2 px-1 text-xs font-medium tracking-wide uppercase">
        Done this week · {tasks.length}
      </h2>
      <div className="max-h-60 overflow-y-auto rounded-lg border 2xl:max-h-[70vh]">
        {tasks.length === 0 ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-sm">
            Nothing completed this week.
          </p>
        ) : (
          tasks.map((t) => {
            const project = projects.find((p) => p.id === t.projectId);
            return (
              <div key={t.id} className="flex flex-col gap-0.5 border-b px-3 py-2 last:border-b-0">
                <span className="line-clamp-2 text-sm leading-snug wrap-break-word">
                  {t.content}
                </span>
                <div className={cn(META_ROW, "text-muted-foreground")}>
                  {t.completedAt && (
                    <span className={META_CHIP}>{weekday(dateStrInTz(new Date(t.completedAt), tz))}</span>
                  )}
                  {t.timeUsed !== null && (
                    <span className={META_CHIP} title="Time used">
                      <Hourglass className="size-3" />
                      {formatDuration(t.timeUsed)}
                    </span>
                  )}
                  {project && !project.isInbox && (
                    <span className={PROJECT_CHIP}># {project.name}</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

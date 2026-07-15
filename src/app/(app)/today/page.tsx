"use client";

import { QuickAdd } from "@/components/quick-add";
import { RoutineRecap } from "@/components/routine-recap";
import { TaskList } from "@/components/task-list";
import { useTimezone } from "@/components/timezone-context";
import { todayStr } from "@/lib/date";
import { useTasks } from "@/hooks/use-tasks";
import { useProjects } from "@/hooks/use-projects";

export default function TodayPage() {
  const tz = useTimezone();
  const today = todayStr(tz);
  const { data: tasks = [], isLoading, isError, refetch } = useTasks();
  const { data: projects = [] } = useProjects();

  const due = tasks.filter(
    (t) => t.status === "active" && t.dueDate !== null && t.dueDate <= today,
  );
  // Overdue: oldest-overdue-first by due date, then order/created/id (TDD §5).
  const overdue = due
    .filter((t) => t.dueDate! < today)
    .sort(
      (a, b) =>
        a.dueDate!.localeCompare(b.dueDate!) ||
        a.order - b.order ||
        a.createdAt.localeCompare(b.createdAt),
    );
  const dueToday = due
    .filter((t) => t.dueDate === today)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Today</h1>
      <p className="text-muted-foreground mb-4 text-sm">{today}</p>

      <RoutineRecap />

      <div className="overflow-hidden rounded-lg border">
        <QuickAdd
          defaultDueDate={today}
          placeholder="Add a task for today…"
          shortcut
        />
        {isError && (
          <div className="px-3 py-8 text-sm">
            <span className="text-red-600">Couldn&apos;t load tasks.</span>{" "}
            <button className="underline" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        )}
        {!isError && overdue.length > 0 && (
          <>
            <div className="text-muted-foreground bg-muted/40 px-3 py-1.5 text-xs font-medium tracking-wide uppercase">
              Overdue
            </div>
            <TaskList tasks={overdue} projects={projects} showProject />
          </>
        )}
        {!isError && (
          <>
            <div className="text-muted-foreground bg-muted/40 px-3 py-1.5 text-xs font-medium tracking-wide uppercase">
              Today
            </div>
            <TaskList
              tasks={dueToday}
              projects={projects}
              showProject
              empty={isLoading ? "Loading…" : "Nothing due today. 🎉"}
            />
          </>
        )}
      </div>
    </div>
  );
}

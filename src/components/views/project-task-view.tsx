"use client";

import { useState } from "react";
import { QuickAdd } from "@/components/quick-add";
import { TaskList } from "@/components/task-list";
import { useTasks } from "@/hooks/use-tasks";
import { useProjects } from "@/hooks/use-projects";

/** Flat task view for a single project (Inbox or a user project). */
export function ProjectTaskView({
  projectId,
  title,
}: {
  projectId: string;
  title: string;
}) {
  const { data: tasks = [], isLoading, isError, refetch } = useTasks();
  const { data: projects = [] } = useProjects();
  const [showCompleted, setShowCompleted] = useState(false);

  // Routine days are left out: a project list holds tasks, and a routine's
  // days are shown on the Upcoming board and the Activity page.
  const own = tasks.filter(
    (t) => t.projectId === projectId && t.routineId === null,
  );
  const active = own
    .filter((t) => t.status === "active")
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
  const completed = own
    .filter((t) => t.status === "completed")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">{title}</h1>

      <div className="overflow-hidden rounded-lg border">
        <QuickAdd defaultProjectId={projectId} shortcut />
        {isError ? (
          <div className="px-3 py-8 text-sm">
            <span className="text-red-600">Couldn&apos;t load tasks.</span>{" "}
            <button className="underline" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        ) : (
          <TaskList
            tasks={active}
            projects={projects}
            empty={isLoading ? "Loading…" : "No tasks yet. Add one above."}
          />
        )}
      </div>

      {completed.length > 0 && (
        <div className="mt-5">
          <button
            className="text-muted-foreground hover:text-foreground text-sm"
            onClick={() => setShowCompleted((s) => !s)}
          >
            {showCompleted ? "Hide" : "Show"} completed ({completed.length})
          </button>
          {showCompleted && (
            <div className="mt-2 overflow-hidden rounded-lg border">
              <TaskList tasks={completed} projects={projects} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

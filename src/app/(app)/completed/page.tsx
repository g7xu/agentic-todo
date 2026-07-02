"use client";

import { TaskList } from "@/components/task-list";
import { useTasks } from "@/hooks/use-tasks";
import { useProjects } from "@/hooks/use-projects";

export default function CompletedPage() {
  const { data: tasks = [], isLoading } = useTasks();
  const { data: projects = [] } = useProjects();

  const completed = tasks
    .filter((t) => t.status === "completed")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Completed</h1>
      <div className="overflow-hidden rounded-lg border">
        <TaskList
          tasks={completed}
          projects={projects}
          showProject
          empty={isLoading ? "Loading…" : "No completed tasks yet."}
        />
      </div>
    </div>
  );
}

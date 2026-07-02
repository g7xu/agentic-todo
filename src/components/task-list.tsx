"use client";

import { TaskRow } from "@/components/task-row";
import type { ProjectDTO, TaskDTO } from "@/lib/types";

export function TaskList({
  tasks,
  projects,
  showProject = false,
  empty = "Nothing here.",
}: {
  tasks: TaskDTO[];
  projects: ProjectDTO[];
  showProject?: boolean;
  empty?: string;
}) {
  if (tasks.length === 0) {
    return <p className="text-muted-foreground px-3 py-8 text-sm">{empty}</p>;
  }
  return (
    <div>
      {tasks.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          projects={projects}
          showProject={showProject}
        />
      ))}
    </div>
  );
}

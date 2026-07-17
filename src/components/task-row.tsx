"use client";

import { useState } from "react";
import { Clock, Flag, MoreHorizontal, Pencil, Repeat, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useTimezone } from "@/components/timezone-context";
import { todayStr } from "@/lib/date";
import { minutesToHHMM } from "@/lib/duration";
import {
  useCompleteTask,
  useDeleteTask,
  useUncompleteTask,
} from "@/hooks/use-tasks";
import { EditTaskDialog } from "@/components/edit-task-dialog";
import type { ProjectDTO, TaskDTO } from "@/lib/types";

const PRIORITY_COLOR: Record<number, string> = {
  1: "text-red-500",
  2: "text-orange-500",
  3: "text-blue-500",
  4: "",
};

function dueLabel(due: string, today: string): string {
  if (due === today) return "Today";
  const d = new Date(`${due}T00:00:00Z`);
  const t = new Date(`${today}T00:00:00Z`);
  const diff = Math.round((d.getTime() - t.getTime()) / 86_400_000);
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function TaskRow({
  task,
  projects,
  showProject = false,
}: {
  task: TaskDTO;
  projects: ProjectDTO[];
  showProject?: boolean;
}) {
  const tz = useTimezone();
  const today = todayStr(tz);
  const complete = useCompleteTask();
  const uncomplete = useUncompleteTask();
  const del = useDeleteTask();
  const [editing, setEditing] = useState(false);

  const isCompleted = task.status === "completed";
  const overdue = !isCompleted && task.dueDate !== null && task.dueDate < today;
  const project = projects.find((p) => p.id === task.projectId);
  const isTemp = task.id.startsWith("temp-");

  return (
    <div
      className="group hover:bg-accent/40 flex cursor-pointer items-center gap-3 border-b px-3 py-2"
      onClick={(e) => {
        // React bubbles portal events through the component tree, so clicks
        // inside the (portaled) edit dialog land here too — skip anything
        // that isn't physically inside the row.
        if (!e.currentTarget.contains(e.target as Node)) return;
        if (!isTemp) setEditing(true);
      }}
    >
      <Checkbox
        checked={isCompleted}
        disabled={isTemp}
        aria-label={isCompleted ? "Mark active" : "Complete task"}
        onClick={(e) => e.stopPropagation()} // checking must not open the editor
        onCheckedChange={(checked) =>
          checked ? complete.mutate(task.id) : uncomplete.mutate(task.id)
        }
      />

      {task.priority < 4 && (
        <Flag className={cn("size-3.5 shrink-0", PRIORITY_COLOR[task.priority])} />
      )}

      <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
        <span
          className={cn(
            "truncate text-sm",
            isCompleted && "text-muted-foreground line-through",
          )}
        >
          {task.content}
        </span>
        {(task.dueDate ||
          task.timeUsed !== null ||
          task.routineId ||
          (showProject && project && !project.isInbox)) && (
          <div className="flex items-center gap-2 text-xs">
            {task.dueDate && (
              <span className={overdue ? "text-red-500" : "text-muted-foreground"}>
                {dueLabel(task.dueDate, today)}
              </span>
            )}
            {task.timeUsed !== null && (
              <span className="text-muted-foreground flex items-center gap-0.5">
                <Clock className="size-3" />
                {minutesToHHMM(task.timeUsed)}
              </span>
            )}
            {task.routineId && (
              <span
                className="text-muted-foreground flex items-center gap-0.5"
                title="Daily routine"
              >
                <Repeat className="size-3" />
              </span>
            )}
            {showProject && project && !project.isInbox && (
              <span className="text-muted-foreground"># {project.name}</span>
            )}
          </div>
        )}
      </div>

      {!isTemp && (
        <>
          <button
            aria-label="Edit task"
            className="hover:bg-accent rounded p-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            <Pencil className="size-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Task options"
              className="hover:bg-accent rounded p-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => del.mutate(task.id)}
              >
                <Trash2 className="size-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {editing && (
            <EditTaskDialog
              task={task}
              projects={projects}
              open={editing}
              onOpenChange={setEditing}
            />
          )}
        </>
      )}
    </div>
  );
}

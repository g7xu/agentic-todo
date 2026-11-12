"use client";

import { useState } from "react";
import { Bot, ChevronDown, ChevronRight } from "lucide-react";
import { TaskRow } from "@/components/task-row";
import { useProjects } from "@/hooks/use-projects";
import { useTasks } from "@/hooks/use-tasks";

/**
 * The tasks Claude finished that the user has not closed yet, from every
 * project (docs/AGENT-TASKS.md AT8). Opening a row shows the report and the
 * reply box; completing the task or replying takes it off the list. Renders
 * nothing when there is nothing to review.
 */
export function DoneByClaude({ className }: { className?: string }) {
  const { data: tasks = [] } = useTasks();
  const { data: projects = [] } = useProjects();
  const [open, setOpen] = useState(true);

  const done = tasks.filter(
    (t) => t.agentState === "done" && t.status === "active",
  );
  if (done.length === 0) return null;

  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className={className} aria-label="Done by Claude">
      <button
        className="text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1.5 text-sm"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Chevron className="size-4" />
        <Bot className="size-4" />
        Done by Claude, waiting for your review ({done.length})
      </button>
      {open && (
        <div className="flex items-start gap-3 overflow-x-auto pb-2">
          {done.map((t) => (
            <div
              key={t.id}
              className="bg-card w-72 shrink-0 overflow-hidden rounded-md border shadow-sm [&>div]:border-b-0"
            >
              <TaskRow task={t} projects={projects} showProject />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

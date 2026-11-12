"use client";

import { useState } from "react";
import { Bot, ChevronDown, ChevronRight } from "lucide-react";
import { TaskRow } from "@/components/task-row";
import { useProjects } from "@/hooks/use-projects";
import { useTasks } from "@/hooks/use-tasks";

/**
 * The tasks where the agent's next step is the user's, from every project
 * (docs/AGENT-TASKS.md AT8): its open questions first, then the work it
 * finished. Opening a card shows the question or report and the reply box;
 * replying or completing the task takes it off the row. Renders nothing when
 * no task is waiting.
 */
export function WaitingOnYou({ className }: { className?: string }) {
  const { data: tasks = [] } = useTasks();
  const { data: projects = [] } = useProjects();
  const [open, setOpen] = useState(true);

  const active = tasks.filter((t) => t.status === "active");
  const waiting = [
    ...active.filter((t) => t.agentState === "needs_input"),
    ...active.filter((t) => t.agentState === "done"),
  ];
  if (waiting.length === 0) return null;

  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className={className} aria-label="AI agent is waiting on you">
      <button
        className="text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1.5 text-sm"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Chevron className="size-4" />
        <Bot className="size-4" />
        AI agent is waiting on you ({waiting.length})
      </button>
      {open && (
        <div className="flex items-start gap-3 overflow-x-auto pb-2">
          {waiting.map((t) => (
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

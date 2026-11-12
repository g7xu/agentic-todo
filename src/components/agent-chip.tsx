"use client";

import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { META_CHIP } from "@/lib/task-meta";
import type { AgentState, TaskDTO } from "@/lib/types";

/** What each hand-off state reads as on a task (docs/AGENT-TASKS.md). */
export const AGENT_LABEL: Record<AgentState, string> = {
  suggested: "Suggested by Claude",
  ready: "For Claude",
  working: "Claude is on it",
  needs_input: "Claude needs you",
  done: "Done by Claude",
};

const AGENT_COLOR: Record<AgentState, string> = {
  suggested: "text-muted-foreground",
  ready: "text-violet-600",
  working: "text-violet-600",
  needs_input: "text-amber-600",
  done: "text-muted-foreground",
};

/** The chip on a list row or board card; nothing for a task Claude leaves alone. */
export function AgentChip({ task }: { task: TaskDTO }) {
  if (!task.agentState) return null;
  // On a completed task only "Done by Claude" still says something true.
  if (task.status !== "active" && task.agentState !== "done") return null;
  return (
    <span
      className={cn(META_CHIP, AGENT_COLOR[task.agentState])}
      title={task.agentQuestion ?? AGENT_LABEL[task.agentState]}
    >
      <Bot className="size-3" />
      {AGENT_LABEL[task.agentState]}
    </span>
  );
}

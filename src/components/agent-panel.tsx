"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_LABEL } from "@/components/agent-chip";
import {
  useAnswerAgent,
  useHandToAgent,
  useTakeBackFromAgent,
  useTaskActivity,
} from "@/hooks/use-agent-tasks";
import type { TaskActivityDTO, TaskDTO } from "@/lib/types";

const KIND_LABEL: Record<TaskActivityDTO["kind"], string> = {
  progress: "Progress",
  question: "Question",
  answer: "Your answer",
  report: "Report",
  released: "Put back",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The hand-off section of the edit dialog (docs/AGENT-TASKS.md): hand the
 * task to Claude or take it back, answer its question, and read its log.
 * The log is the agent's report; the description above stays the user's.
 */
export function AgentPanel({ task, open }: { task: TaskDTO; open: boolean }) {
  const hand = useHandToAgent();
  const takeBack = useTakeBackFromAgent();
  const reply = useAnswerAgent();
  const [answer, setAnswer] = useState("");
  const log = useTaskActivity(task.id, open && task.agentState !== null);

  const state = task.agentState;
  const isRoutineDay = task.routineId !== null;
  const active = task.status === "active";
  const canHand =
    active && !isRoutineDay && (state === null || state === "suggested" || state === "done");
  const canTakeBack = state === "ready" || state === "working" || state === "needs_input";

  if (isRoutineDay && state === null) return null;

  return (
    <div className="grid gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Bot className="size-4" />
          {state ? AGENT_LABEL[state] : "Claude"}
        </span>
        <div className="flex gap-2">
          {canHand && (
            <Button
              size="sm"
              variant="secondary"
              disabled={hand.isPending}
              onClick={() => hand.mutate(task.id)}
            >
              {state === "suggested" ? "Let Claude do it" : "Hand to Claude"}
            </Button>
          )}
          {canTakeBack && (
            <Button
              size="sm"
              variant="outline"
              disabled={takeBack.isPending}
              onClick={() => takeBack.mutate(task.id)}
            >
              Take back
            </Button>
          )}
        </div>
      </div>

      {state === null && canHand && (
        <p className="text-muted-foreground text-xs">
          Claude works only the tasks you hand to it, and asks you here when it
          needs something.
        </p>
      )}
      {state === "suggested" && (
        <p className="text-muted-foreground text-xs">
          Claude added this. It won&apos;t start until you hand it over.
        </p>
      )}

      {state === "needs_input" && task.agentQuestion && (
        <div className="grid gap-1.5">
          <Label htmlFor={`answer-${task.id}`} className="whitespace-pre-wrap">
            {task.agentQuestion}
          </Label>
          <Textarea
            id={`answer-${task.id}`}
            value={answer}
            placeholder="Your answer"
            onChange={(e) => setAnswer(e.target.value)}
          />
          <Button
            size="sm"
            className="justify-self-end"
            disabled={!answer.trim() || reply.isPending}
            onClick={() =>
              reply.mutate(
                { id: task.id, text: answer.trim() },
                { onSuccess: () => setAnswer("") },
              )
            }
          >
            Send answer
          </Button>
        </div>
      )}

      {log.data && log.data.length > 0 && (
        <ol className="grid max-h-56 gap-2 overflow-y-auto text-sm">
          {log.data.map((e) => (
            <li key={e.id} className="grid gap-0.5">
              <span className="text-muted-foreground text-xs">
                {KIND_LABEL[e.kind]} · {when(e.createdAt)}
              </span>
              <span className="whitespace-pre-wrap wrap-break-word">{e.content}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

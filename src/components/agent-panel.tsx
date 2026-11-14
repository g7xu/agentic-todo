"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_LABEL } from "@/components/agent-chip";
import { Linkified } from "@/components/linkified";
import { cn } from "@/lib/utils";
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
  answer: "Your reply",
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
 * task to the agent or take it back, answer its question, and read its log.
 * The log is the agent's report; the description stays the user's.
 *
 * Given a bounded height at `md` and up, the panel reads as a thread: the log
 * scrolls, opening at its newest entry, and the reply box stays in view under
 * it. Unbounded, it grows with its content and the reply box comes first, so
 * answering never means scrolling past the history.
 */
export function AgentPanel({
  task,
  open,
  className,
}: {
  task: TaskDTO;
  open: boolean;
  className?: string;
}) {
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
  // A reply returns the task to the agent's queue: an answer to its question, or
  // a response to work it finished that the user has not completed (AT8).
  const replyPrompt =
    state === "needs_input"
      ? task.agentQuestion
      : state === "done" && active
        ? "Not right yet? Reply to send it back to the AI agent, or complete the task to close it."
        : null;

  // The open question is drawn once, over the reply box. It has to live there
  // rather than in the log, which may still be loading or have failed.
  const entries = (log.data ?? []).filter(
    (e, i, all) =>
      !(
        state === "needs_input" &&
        i === all.length - 1 &&
        e.kind === "question" &&
        e.content === task.agentQuestion
      ),
  );

  if (isRoutineDay && state === null) return null;

  return (
    <div className={cn("flex min-w-0 flex-col gap-3 rounded-md border p-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Bot className="size-4" />
          {state ? AGENT_LABEL[state] : "AI agent"}
        </span>
        <div className="flex gap-2">
          {canHand && (
            <Button
              size="sm"
              variant="secondary"
              disabled={hand.isPending}
              onClick={() => hand.mutate(task.id)}
            >
              {state === "suggested" ? "Let AI agent do it" : "Hand to AI agent"}
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
          An AI agent works only the tasks you hand to it, and asks you here when
          it needs something.
        </p>
      )}
      {state === "suggested" && (
        <p className="text-muted-foreground text-xs">
          An AI agent added this. It won&apos;t start until you hand it over.
        </p>
      )}

      {replyPrompt && (
        <div className="grid shrink-0 gap-1.5 md:order-last md:border-t md:pt-3">
          <Label
            htmlFor={`answer-${task.id}`}
            className={cn(
              "leading-snug whitespace-pre-wrap wrap-break-word",
              state !== "needs_input" && "text-muted-foreground font-normal",
            )}
          >
            <Linkified text={replyPrompt} />
          </Label>
          <Textarea
            id={`answer-${task.id}`}
            value={answer}
            placeholder="Your reply"
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
            {state === "done" ? "Send back to AI agent" : "Send answer"}
          </Button>
        </div>
      )}

      {entries.length > 0 && (
        // A reversed column starts scrolled to its end, which is the newest
        // entry. The list's auto margin keeps a short log at the top.
        <div className="flex min-h-0 flex-1 flex-col-reverse md:overflow-y-auto">
          <ol className="mb-auto flex flex-col gap-3 text-sm">
            {entries.map((e) => (
              <li
                key={e.id}
                className={cn(
                  "grid min-w-0 gap-0.5",
                  e.author === "user" && "bg-muted rounded-md px-2 py-1.5",
                )}
              >
                <span className="text-muted-foreground text-xs">
                  {KIND_LABEL[e.kind]} · {when(e.createdAt)}
                </span>
                <span className="min-w-0 whitespace-pre-wrap wrap-break-word">
                  <Linkified text={e.content} />
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

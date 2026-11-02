"use client";

import { Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/duration";
import { formatElapsed } from "@/lib/timer";
import { META_CHIP } from "@/lib/task-meta";
import { useTimerControls } from "@/components/running-timer";
import {
  useIsRunning,
  useRunningOver,
  useRunningTotal,
  useStartTimer,
} from "@/hooks/use-timer";
import type { TaskDTO } from "@/lib/types";

/**
 * Running is emerald. Blue is taken by priority 3, and amber already means
 * "past the plan" on the Estimate-vs-actual bars, which is what it means here.
 * The `!` on border colors outranks neon-auth's universal border rule (see
 * PRIORITY_CIRCLE in `upcoming-board.tsx`).
 */
export const RUNNING_BORDER = "border-emerald-500!";
export const OVER_BORDER = "border-amber-500!";

/**
 * Play/stop for one task. Hidden until hover on desktop like the card's `⋯`
 * button, except while running, when it is the only way to see which card
 * owns the timer at a glance. Swallows pointer-down and click so it neither
 * starts a drag nor opens the editor.
 */
export function TimerButton({
  task,
  className,
}: {
  task: TaskDTO;
  className?: string;
}) {
  const running = useIsRunning(task.id);
  const over = useRunningOver(task.id, task.estimate);
  const start = useStartTimer();
  const { stop } = useTimerControls();
  return (
    <button
      type="button"
      aria-label={
        running
          ? `Stop timing “${task.content}”`
          : `Start timing “${task.content}”`
      }
      title={running ? "Stop timer" : "Start timer"}
      className={cn(
        "hover:bg-accent rounded p-0.5",
        !running && "md:opacity-0 md:group-hover:opacity-100 focus:opacity-100",
        running && (over ? "text-amber-600" : "text-emerald-600"),
        className,
      )}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (running) stop();
        else start.mutate(task);
      }}
    >
      {running ? (
        <Square className="size-4 fill-current" />
      ) : (
        <Play className="size-4" />
      )}
    </button>
  );
}

/**
 * The running card's count and, when the task has an estimate, a bar toward
 * it: emerald up to the estimate, amber past it. Mounted only on the running
 * card, so only that card re-renders every second.
 */
export function RunningTime({ estimate }: { estimate: number | null }) {
  const { seconds } = useRunningTotal();
  if (seconds === null) return null;
  const planned = estimate !== null && estimate > 0 ? estimate * 60 : null;
  const over = planned !== null && seconds > planned;
  // Both segments share one scale, whichever of the two is larger, so the
  // overrun reads as a proportion of everything spent.
  const scale = planned === null ? 0 : Math.max(seconds, planned);
  return (
    <div className="flex flex-col gap-1">
      <span
        className={cn(
          META_CHIP,
          "text-xs",
          over ? "text-amber-600" : "text-emerald-600",
        )}
      >
        <span aria-hidden className="mr-0.5 size-1.5 rounded-full bg-current" />
        {formatElapsed(seconds)}
        {planned !== null && (
          <span className="text-muted-foreground">
            &nbsp;of {formatDuration(estimate!)}
          </span>
        )}
      </span>
      {planned !== null && (
        <div
          aria-hidden
          className="bg-muted flex h-1 w-full overflow-hidden rounded-full"
        >
          <div
            className="bg-emerald-500"
            style={{ width: `${(Math.min(seconds, planned) / scale) * 100}%` }}
          />
          {over && (
            <div
              className="bg-amber-500"
              style={{ width: `${((seconds - planned) / scale) * 100}%` }}
            />
          )}
        </div>
      )}
    </div>
  );
}

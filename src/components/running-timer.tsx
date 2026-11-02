"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Square } from "lucide-react";
import { useTimezone } from "@/components/timezone-context";
import { StopReviewDialog } from "@/components/stop-review-dialog";
import {
  useDiscardTimer,
  useRunningTotal,
  useStopTimer,
  useTimer,
} from "@/hooks/use-timer";
import { formatElapsed, needsStopReview } from "@/lib/timer";

type Controls = {
  /** Stops the running timer, asking first when the session ran long (DT4). */
  stop: () => void;
  /**
   * Runs `complete` for `taskId`. When that task's timer ran long, the review
   * comes first and completion waits on its answer; otherwise completing
   * stops the timer on the server (DT5) and nothing is asked.
   */
  beforeComplete: (taskId: string, complete: () => void) => void;
};

const TimerControls = createContext<Controls | null>(null);

export function useTimerControls(): Controls {
  const c = useContext(TimerControls);
  if (!c) throw new Error("useTimerControls must be used inside TimerProvider");
  return c;
}

type Review = { endedAt: Date; then?: () => void };

/**
 * Owns the one stop-review dialog, so the card button, the header pill and
 * completion all ask the same way. Mounted in `AppShell`.
 */
export function TimerProvider({ children }: { children: React.ReactNode }) {
  const tz = useTimezone();
  const { data } = useTimer();
  const stopTimer = useStopTimer();
  const discardTimer = useDiscardTimer();
  const [review, setReview] = useState<Review | null>(null);
  const timer = data?.timer ?? null;

  /** The server's now when this session should be reviewed, else null. */
  function reviewAt(): Date | null {
    if (!timer) return null;
    const now = new Date(Date.now() + (data?.offsetMs ?? 0));
    return needsStopReview(new Date(timer.startedAt), now, tz) ? now : null;
  }

  const controls: Controls = {
    stop: () => {
      const at = reviewAt();
      if (at) setReview({ endedAt: at });
      else stopTimer.mutate();
    },
    beforeComplete: (taskId, complete) => {
      const at = timer?.taskId === taskId ? reviewAt() : null;
      if (at) setReview({ endedAt: at, then: complete });
      else complete();
    },
  };

  const settle = (then?: () => void) => {
    setReview(null);
    return { onSuccess: () => then?.() };
  };

  return (
    <TimerControls.Provider value={controls}>
      {children}
      {review && timer && (
        <StopReviewDialog
          content={timer.content}
          estimate={timer.estimate}
          startedAt={new Date(timer.startedAt)}
          endedAt={review.endedAt}
          onKeep={() =>
            stopTimer.mutate({ endedAt: review.endedAt }, settle(review.then))
          }
          onStoppedAt={(at) =>
            stopTimer.mutate({ endedAt: at }, settle(review.then))
          }
          onDiscard={() => discardTimer.mutate(undefined, settle(review.then))}
          onCancel={() => setReview(null)}
        />
      )}
    </TimerControls.Provider>
  );
}

/**
 * Shows the running time in the tab title, putting the page's own title back
 * when the timer stops. A navigation resets the title; the next tick, within a
 * second, sets it again.
 */
function useTabTitle(title: string | null) {
  const original = useRef<string | null>(null);
  useEffect(() => {
    if (title === null) {
      if (original.current !== null) document.title = original.current;
      original.current = null;
      return;
    }
    if (original.current === null) original.current = document.title;
    document.title = title;
  }, [title]);
}

/** The header's view of the running timer, visible from every page. */
export function RunningTimerPill() {
  const { timer, seconds } = useRunningTotal();
  const { stop } = useTimerControls();
  const elapsed = seconds === null ? null : formatElapsed(seconds);
  useTabTitle(timer && elapsed ? `${elapsed} · ${timer.content}` : null);
  if (!timer || elapsed === null) return null;
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-full border border-emerald-500/40! bg-emerald-500/10 py-0.5 pr-0.5 pl-2.5 text-xs text-emerald-700 dark:text-emerald-400">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      <span
        className="hidden max-w-40 truncate sm:inline"
        title={timer.content}
      >
        {timer.content}
      </span>
      <span className="tabular-nums">{elapsed}</span>
      <button
        type="button"
        aria-label={`Stop timing “${timer.content}”`}
        title="Stop timer"
        className="flex size-6 items-center justify-center rounded-full hover:bg-emerald-500/20"
        onClick={stop}
      >
        <Square className="size-3 fill-current" />
      </button>
    </div>
  );
}

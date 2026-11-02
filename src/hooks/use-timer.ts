"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { RunningTimerDTO, TaskDTO, TimerStateDTO } from "@/lib/types";
import {
  discardTimerAction,
  startTimerAction,
  stopTimerAction,
  type TimerActionResult,
} from "@/app/actions/timers";
import { TASKS_KEY } from "@/hooks/use-tasks";

/**
 * Keyed under TASKS_KEY so every task write that invalidates the list also
 * re-reads the timer: completing or deleting the running task stops it on the
 * server (docs/TIMERS.md DT5), and this is how the header finds out.
 */
export const TIMER_KEY = [...TASKS_KEY, "timer"] as const;

/** `offsetMs` is server clock minus this device's, measured when the state
 * arrived; adding it to `Date.now()` gives the server's now (DT7). */
export type TimerCache = { timer: RunningTimerDTO | null; offsetMs: number };

function toCache(s: TimerStateDTO): TimerCache {
  return { timer: s.timer, offsetMs: Date.parse(s.now) - Date.now() };
}

/** Refetched on every focus: that is the whole mechanism by which a timer
 * started on another device shows up here (DT1). */
export function useTimer() {
  return useQuery({
    queryKey: TIMER_KEY,
    queryFn: async (): Promise<TimerCache> => {
      const res = await fetch("/api/timer");
      if (!res.ok) throw new Error("Failed to load the timer");
      return toCache((await res.json()) as TimerStateDTO);
    },
    refetchOnWindowFocus: "always",
  });
}

type Ctx = { prev?: TimerCache };

/**
 * Shared shape of the three timer writes: an optimistic timer, rollback with a
 * toast on failure, and on success the server's state plus the task whose
 * `timeUsed` changed, patched into the list in place. The list itself is not
 * refetched; that read is the heavy one.
 */
function useTimerMutation<V>(
  write: (vars: V) => Promise<TimerActionResult>,
  optimistic: (vars: V, old: TimerCache | undefined) => TimerCache,
  failure: string,
) {
  const qc = useQueryClient();
  return useMutation<TimerActionResult, Error, V, Ctx>({
    mutationFn: write,
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: TIMER_KEY, exact: true });
      const prev = qc.getQueryData<TimerCache>(TIMER_KEY);
      qc.setQueryData(TIMER_KEY, optimistic(vars, prev));
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      qc.setQueryData(TIMER_KEY, ctx?.prev);
      console.error(`${failure}:`, e);
      toast.error(failure);
    },
    onSuccess: (data) => {
      qc.setQueryData(TIMER_KEY, toCache(data));
      const changed = data.changed;
      if (changed) {
        qc.setQueryData<TaskDTO[]>(TASKS_KEY, (old) =>
          old?.map((t) => (t.id === changed.id ? changed : t)),
        );
      }
    },
  });
}

const stopped = (old: TimerCache | undefined): TimerCache => ({
  timer: null,
  offsetMs: old?.offsetMs ?? 0,
});

/** Starts timing `task`, stopping whatever runs (DT3). */
export function useStartTimer() {
  return useTimerMutation<TaskDTO>(
    (task) => startTimerAction(task.id),
    (task, old) => {
      const offsetMs = old?.offsetMs ?? 0;
      return {
        offsetMs,
        timer: {
          taskId: task.id,
          content: task.content,
          estimate: task.estimate,
          timeUsed: task.timeUsed,
          startedAt: new Date(Date.now() + offsetMs).toISOString(),
        },
      };
    },
    "Couldn’t start the timer",
  );
}

/** Stops the running timer, at `endedAt` when the long-run prompt set one. */
export function useStopTimer() {
  return useTimerMutation<{ endedAt?: Date } | void>(
    (vars) => stopTimerAction(vars?.endedAt?.toISOString()),
    (_vars, old) => stopped(old),
    "Couldn’t stop the timer",
  );
}

export function useDiscardTimer() {
  return useTimerMutation<void>(
    () => discardTimerAction(),
    (_vars, old) => stopped(old),
    "Couldn’t discard the timer",
  );
}

/**
 * Seconds since `startedAt` by the server's clock, re-rendering once a second
 * while a timer runs and not at all otherwise. Null when nothing runs.
 */
export function useElapsed(
  startedAt: string | null,
  offsetMs: number,
): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (startedAt === null) return null;
  // `now` is up to a second old right after a start, so clamp rather than
  // show a negative count.
  return Math.max(0, (now + offsetMs - Date.parse(startedAt)) / 1000);
}

/** True when `task` is the one being timed. */
export function useIsRunning(taskId: string): boolean {
  return useTimer().data?.timer?.taskId === taskId;
}

/**
 * True once the running `taskId` has passed `estimate`. Instead of ticking, it
 * schedules one timeout for the moment the total crosses the estimate, so a
 * card can colour its border without re-rendering every second.
 */
export function useRunningOver(
  taskId: string,
  estimate: number | null,
): boolean {
  const { data } = useTimer();
  const timer = data?.timer?.taskId === taskId ? data.timer : null;
  const overAt =
    timer && estimate !== null && estimate > 0
      ? Date.parse(timer.startedAt) -
        (data?.offsetMs ?? 0) +
        (estimate - (timer.timeUsed ?? 0)) * 60_000
      : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (overAt === null) return;
    const id = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, overAt - Date.now()),
    );
    return () => clearTimeout(id);
  }, [overAt]);
  return overAt !== null && now >= overAt;
}

/**
 * Seconds of work on the running task: what was recorded before this session
 * plus the session so far. The card, header pill and tab title all show this
 * one number, so they never disagree.
 */
export function useRunningTotal(): {
  timer: RunningTimerDTO | null;
  seconds: number | null;
} {
  const { data } = useTimer();
  const timer = data?.timer ?? null;
  const elapsed = useElapsed(timer?.startedAt ?? null, data?.offsetMs ?? 0);
  if (!timer || elapsed === null) return { timer: null, seconds: null };
  return { timer, seconds: (timer.timeUsed ?? 0) * 60 + elapsed };
}

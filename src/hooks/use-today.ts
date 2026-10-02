"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTimezone } from "@/components/timezone-context";
import { todayStr } from "@/lib/date";
import { ROUTINES_KEY } from "@/hooks/use-routines";
import { TASKS_KEY } from "@/hooks/use-tasks";

/** How often an open page re-reads the clock. A day boundary is noticed at
 * most this long after it happens. */
const CLOCK_POLL_MS = 60_000;

/** Also re-reads when the tab becomes visible: browsers throttle timers in
 * background tabs, so a poll alone can sleep through midnight. */
function subscribeToClock(onChange: () => void): () => void {
  const timer = setInterval(onChange, CLOCK_POLL_MS);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onChange);
  };
}

/**
 * Today ('YYYY-MM-DD') in the profile timezone, kept current while the page
 * stays open. Views that place things by day read this instead of calling
 * `todayStr` during render, which is only ever right at the moment of the last
 * render.
 */
export function useToday(): string {
  const tz = useTimezone();
  const read = useCallback(() => todayStr(tz), [tz]);
  return useSyncExternalStore(subscribeToClock, read, read);
}

/**
 * Refetches tasks and routines when the local day changes. Mount once, high in
 * the tree. The first render is not a change of day, so it fetches nothing.
 */
export function useRefetchOnNewDay(): void {
  const today = useToday();
  const queryClient = useQueryClient();
  const seen = useRef(today);

  useEffect(() => {
    if (seen.current === today) return;
    seen.current = today;
    queryClient.invalidateQueries({ queryKey: TASKS_KEY });
    queryClient.invalidateQueries({ queryKey: ROUTINES_KEY });
  }, [today, queryClient]);
}

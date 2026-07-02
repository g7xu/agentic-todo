"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { captureTimezone } from "@/app/actions/timezone";

/**
 * Mounted (once) only while the user's profile has `tzCaptured = false`.
 * Reads the browser timezone and persists it, then invalidates ['tasks'] so any
 * date-sensitive view re-fetches under the correct tz (TDD §5 self-heal). In
 * Phase 2 the ['tasks'] cache doesn't exist yet, so the invalidation is a
 * harmless no-op until Phase 3.
 */
export function TimezoneCapture() {
  const queryClient = useQueryClient();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    captureTimezone(tz)
      .then(() => queryClient.invalidateQueries({ queryKey: ["tasks"] }))
      .catch(() => {});
  }, [queryClient]);

  return null;
}

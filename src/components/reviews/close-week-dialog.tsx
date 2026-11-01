"use client";

import { useState } from "react";
import { addDays } from "@/lib/date";
import { MAX_CARRIED } from "@/lib/reviews";
import { useCloseReview } from "@/hooks/use-reviews";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ReviewNoteDTO } from "@/lib/types";

function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Picks which action notes to carry, then closes the week. With three or
 * fewer actions all start ticked; with more, the choice is the point.
 */
export function CloseWeekDialog({
  week,
  actions,
  open,
  onOpenChange,
}: {
  week: string;
  actions: ReviewNoteDTO[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const close = useCloseReview(week);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(actions.length <= MAX_CARRIED ? actions.map((a) => a.id) : []),
  );

  function toggle(id: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on && next.size < MAX_CARRIED) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function confirm() {
    try {
      await close.mutateAsync([...picked]);
      onOpenChange(false);
    } catch {
      // The hook already reported it; keep the dialog open to retry.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close the week</DialogTitle>
          <DialogDescription>
            {actions.length === 0
              ? "There are no actions to carry. The board becomes read-only."
              : `Pick up to ${MAX_CARRIED} actions. Each becomes an Inbox task for ${shortDay(
                  addDays(week, 7),
                )}. The board becomes read-only.`}
          </DialogDescription>
        </DialogHeader>
        {actions.length > 0 && (
          <div className="grid gap-2 py-2">
            {actions.map((a) => {
              const checked = picked.has(a.id);
              return (
                <label key={a.id} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={checked}
                    disabled={!checked && picked.size >= MAX_CARRIED}
                    onCheckedChange={(v) => toggle(a.id, v === true)}
                  />
                  <span className="wrap-anywhere">{a.content}</span>
                </label>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={close.isPending}>
            {picked.size === 0 ? "Close week" : `Close and carry ${picked.size}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDuration } from "@/lib/duration";
import { sessionMinutes } from "@/lib/timer";

/** `<input type="datetime-local">` value for `d`, in this device's timezone. */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Asks how a long session should be recorded before it is (docs/TIMERS.md
 * DT4). Closing without choosing leaves the timer running.
 *
 * The time field is the device's local time, which `datetime-local` can't be
 * told otherwise; it matches the profile timezone everywhere but on a device
 * travelling away from it.
 */
export function StopReviewDialog({
  content,
  estimate,
  startedAt,
  endedAt,
  onKeep,
  onStoppedAt,
  onDiscard,
  onCancel,
}: {
  content: string;
  estimate: number | null;
  startedAt: Date;
  /** The moment the review opened; the latest a corrected stop can be. */
  endedAt: Date;
  onKeep: () => void;
  onStoppedAt: (at: Date) => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const ran = formatDuration(sessionMinutes(startedAt, endedAt));
  // A guess at when work really ended: the estimate's worth after the start,
  // or an hour without one, never later than now.
  const guess = new Date(
    Math.min(
      endedAt.getTime(),
      startedAt.getTime() + (estimate && estimate > 0 ? estimate : 60) * 60_000,
    ),
  );
  const [value, setValue] = useState(() => toLocalInput(guess));
  const [error, setError] = useState<string | null>(null);

  function save() {
    const at = new Date(value);
    // The field has no seconds, so the start's own minute reads as "at the
    // start" rather than a few seconds before it.
    if (Number.isNaN(at.getTime())) {
      setError("Enter a date and time.");
    } else if (at.getTime() < startedAt.getTime() - 60_000) {
      setError("That’s before the timer started.");
    } else if (at.getTime() > endedAt.getTime()) {
      setError("That’s later than now.");
    } else {
      onStoppedAt(new Date(Math.max(at.getTime(), startedAt.getTime())));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="pr-6">Timer ran {ran}</DialogTitle>
          <DialogDescription className="wrap-anywhere">
            On “{content}”. When did you actually stop?
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Label htmlFor="stopped-at">Stopped at</Label>
          <div className="flex gap-2">
            <Input
              id="stopped-at"
              type="datetime-local"
              value={value}
              min={toLocalInput(startedAt)}
              max={toLocalInput(endedAt)}
              aria-invalid={error !== null}
              aria-describedby={error ? "stopped-at-error" : undefined}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
            />
            <Button type="submit">Save</Button>
          </div>
          {error && (
            <p id="stopped-at-error" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onDiscard}>
            Discard session
          </Button>
          <Button variant="outline" onClick={onKeep}>
            Keep {ran}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

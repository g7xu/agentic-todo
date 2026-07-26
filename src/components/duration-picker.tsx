"use client";

import { useState, type ComponentType } from "react";
import { Clock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDuration, parseDuration } from "@/lib/duration";

/**
 * The six values durations actually cluster around, so the common case is one
 * click and typing is reserved for the exceptions (docs/ESTIMATES.md DE1).
 */
const PRESETS = [15, 30, 45, 60, 90, 120];

/**
 * Duration entry: preset shortcuts above a free-text field that accepts `30`,
 * `1h30`, `1.5h`, `90m`, and `1:30` (docs/ESTIMATES.md §3.3).
 *
 * Replaces a strict "HH:MM" input where all but the last of those were rejected
 * with nothing but a red border. Structurally a copy of the due-date chip in
 * `quick-add.tsx` — presets in a `DropdownMenu`, a raw input below a separator,
 * and a clear button *outside* the trigger so clicking it doesn't reopen the menu.
 *
 * Only ever emits a valid value or null: unparseable text can't be committed, so
 * callers never need their own validation state.
 */
export function DurationPicker({
  value,
  onChange,
  placeholder = "Estimate",
  icon: Icon = Clock,
  max = 1440,
  fullWidth = false,
  clearLabel = "Clear estimate",
}: {
  value: number | null;
  onChange: (minutes: number | null) => void;
  placeholder?: string;
  icon?: ComponentType<{ className?: string }>;
  /** Upper bound in minutes; over it, input is refused. Estimates cap at 24h (DE3). */
  max?: number;
  /** Fill the container and look like a form field, for use in a dialog's grid. */
  fullWidth?: boolean;
  clearLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const trimmed = draft.trim();
  const parsed = parseDuration(draft);
  const invalid = trimmed !== "" && (parsed === null || parsed > max);

  /** Commit the typed draft. Empty clears; invalid is refused (returns false). */
  function commitDraft(): boolean {
    if (trimmed === "") {
      onChange(null);
      return true;
    }
    if (invalid) return false;
    onChange(parsed);
    return true;
  }

  const trigger = (
    <button
      type="button"
      className={cn(
        "flex h-full items-center gap-1.5 text-sm",
        fullWidth ? "flex-1 px-3 text-left" : "px-2",
        value === null && "text-muted-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {value === null ? placeholder : formatDuration(value)}
    </button>
  );

  return (
    <div
      className={cn(
        "flex items-center rounded-md border",
        fullWidth ? "h-9 w-full" : "h-8",
      )}
    >
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          // Opening reseeds the draft from the committed value, so a
          // typed-but-abandoned entry never survives into the next visit.
          // Closing commits whatever was typed, so a value doesn't need Enter to
          // stick; an invalid draft is dropped rather than blocking the close.
          if (next) setDraft(value === null ? "" : formatDuration(value));
          else commitDraft();
          setOpen(next);
        }}
      >
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {PRESETS.map((m) => (
            <DropdownMenuItem key={m} onSelect={() => onChange(m)}>
              {formatDuration(m)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {/* stopPropagation or the menu's typeahead eats the keystrokes — the
              same guard the date input needs in quick-add.tsx. */}
          <div className="px-2 py-1.5" onKeyDown={(e) => e.stopPropagation()}>
            <input
              value={draft}
              placeholder="e.g. 1h30"
              aria-label="Custom duration"
              aria-invalid={invalid || undefined}
              className={cn(
                "w-28 bg-transparent text-sm outline-none",
                invalid && "text-destructive",
              )}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (commitDraft()) setOpen(false);
              }}
            />
            <p className="text-muted-foreground mt-1 text-xs">
              {invalid
                ? parsed !== null && parsed > max
                  ? `Max ${formatDuration(max)}`
                  : "Try 30, 1h30, or 90m"
                : trimmed === ""
                  ? "30 · 1h30 · 1.5h · 90m"
                  : formatDuration(parsed!)}
            </p>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {value !== null && (
        <button
          type="button"
          aria-label={clearLabel}
          className="text-muted-foreground hover:text-foreground h-full border-l px-1.5"
          onClick={() => onChange(null)}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

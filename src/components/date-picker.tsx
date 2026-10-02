"use client";

import { useState, type ComponentType } from "react";
import { CalendarDays, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToday } from "@/hooks/use-today";
import { addDays, localDateToStr, strToLocalDate } from "@/lib/date";

export type DatePreset = { label: string; offsetDays: number };

export const DUE_DATE_PRESETS: DatePreset[] = [
  { label: "Today", offsetDays: 0 },
  { label: "Tomorrow", offsetDays: 1 },
  { label: "Next week", offsetDays: 7 },
];

/** The hard date is rarely today, so its shortcuts start at tomorrow. */
export const DEADLINE_PRESETS: DatePreset[] = [
  { label: "Tomorrow", offsetDays: 1 },
  { label: "In a week", offsetDays: 7 },
];

/**
 * A 'YYYY-MM-DD' date as chip text. Relative words for the two days people
 * reach for most; otherwise "Oct 12". With `year`, a date outside the current
 * year says so ("Oct 12, 2027") — only where the chip has room for it.
 */
export function dueLabel(
  date: string,
  today: string,
  { year = false }: { year?: boolean } = {},
): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  const showYear = year && date.slice(0, 4) !== today.slice(0, 4);
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(showYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/**
 * Date entry: a row of preset shortcuts above a month grid, in a popover the
 * app positions itself (so it is never clipped by a menu or a column and
 * flips above the trigger when the viewport runs out below).
 *
 * Same anatomy as `DurationPicker`: one component, a compact chip for the
 * composer or a `fullWidth` form field for a dialog grid, and the clear `X` as
 * a sibling *outside* the trigger so clicking it doesn't open the popover.
 *
 * Works in 'YYYY-MM-DD' strings at its boundary; the calendar sees local-
 * midnight Dates and "today" comes from the profile timezone, never the
 * browser clock. Any day can be picked — past days are muted, not disabled —
 * so a late-logged task can still be dated honestly.
 */
export function DatePicker({
  value,
  onChange,
  presets,
  placeholder,
  icon: Icon = CalendarDays,
  fullWidth = false,
  disabled = false,
  clearLabel = "Clear date",
  valueClassName,
  align = "start",
  title,
}: {
  value: string | null;
  onChange: (date: string | null) => void;
  presets: DatePreset[];
  placeholder: string;
  icon?: ComponentType<{ className?: string }>;
  /** Fill the container and look like a form field, for use in a dialog's grid. */
  fullWidth?: boolean;
  disabled?: boolean;
  clearLabel?: string;
  /** Text color for a set value, given the value and today ('YYYY-MM-DD'). */
  valueClassName?: (date: string, today: string) => string;
  align?: "start" | "end";
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const today = useToday();
  const todayDate = strToLocalDate(today);
  const selected = value ? strToLocalDate(value) : undefined;

  function pick(date: string) {
    onChange(date);
    setOpen(false);
  }

  return (
    <div
      title={title}
      className={cn(
        "flex items-center rounded-md border",
        fullWidth ? "h-9 w-full" : "h-8",
        disabled && "bg-input/50 opacity-50",
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "flex h-full min-w-0 flex-1 items-center text-left text-sm disabled:cursor-not-allowed",
              // The compact chip is sized so "Tomorrow ×" fits a 118px grid
              // cell beside three siblings in the board composer.
              fullWidth ? "gap-1.5 px-3" : "gap-1 pl-2 pr-1",
              value
                ? (valueClassName?.(value, today) ?? "text-foreground")
                : "text-muted-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">
              {value ? dueLabel(value, today, { year: fullWidth }) : placeholder}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align={align}
          collisionPadding={8}
          className="max-h-(--radix-popover-content-available-height) w-auto gap-2 overflow-y-auto p-2"
          // A keydown inside the portal still bubbles through the React tree
          // to the composer card, whose Escape handler discards the draft task.
          // Escape here means "close the calendar", nothing more.
          onKeyDown={(e) => {
            if (e.key === "Escape") e.stopPropagation();
          }}
        >
          <div className="flex gap-1">
            {presets.map((p) => (
              <Button
                key={p.label}
                type="button"
                variant="outline"
                size="xs"
                className="flex-1"
                onClick={() => pick(addDays(today, p.offsetDays))}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <Calendar
            mode="single"
            required
            selected={selected}
            defaultMonth={selected ?? todayDate}
            today={todayDate}
            weekStartsOn={0}
            modifiers={{ past: { before: todayDate } }}
            modifiersClassNames={{ past: "text-muted-foreground" }}
            onSelect={(d) => pick(localDateToStr(d))}
            className="p-0"
            // Tighter rows than the stock calendar (a key here replaces the
            // whole class string, so the layout classes are repeated): with
            // the preset row above it, a 5-week month then fits beside the
            // edit dialog's date row in a 600px-tall window without the
            // popover having to scroll.
            classNames={{
              month: "flex w-full flex-col gap-2",
              week: "mt-1 flex w-full",
            }}
          />
        </PopoverContent>
      </Popover>
      {value && !disabled && (
        <button
          type="button"
          aria-label={clearLabel}
          className="text-muted-foreground hover:text-foreground h-full border-l px-1"
          onClick={() => onChange(null)}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

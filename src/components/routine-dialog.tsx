"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useCreateRoutine, useUpdateRoutine } from "@/hooks/use-routines";
import { useTimezone } from "@/components/timezone-context";
import { todayStr, weekdayOf } from "@/lib/date";
import { MAX_EVERY, REPEAT_UNITS, WEEKDAYS } from "@/lib/repeat";
import type {
  ProjectDTO,
  RoutineDTO,
  RoutineRepeatBase,
  RoutineRepeatUnit,
} from "@/lib/types";

const PRIORITIES = [
  { value: "1", label: "P1 — Urgent" },
  { value: "2", label: "P2 — High" },
  { value: "3", label: "P3 — Medium" },
  { value: "4", label: "P4 — None" },
];

/** Create (no `routine`) or edit (with `routine`) a daily routine template.
 * Edits affect future instances only — today's instance keeps its values. */
export function RoutineDialog({
  routine,
  projects,
  open,
  onOpenChange,
}: {
  routine?: RoutineDTO;
  projects: ProjectDTO[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateRoutine();
  const update = useUpdateRoutine();
  const inbox = projects.find((p) => p.isInbox);
  // The server anchors a new routine to the user's local day, so the weekday we
  // pre-tick has to be read in that same timezone — not the browser's.
  const tz = useTimezone();

  const [content, setContent] = useState(routine?.content ?? "");
  const [description, setDescription] = useState(routine?.description ?? "");
  const [priority, setPriority] = useState(String(routine?.priority ?? 4));
  const [projectId, setProjectId] = useState(
    routine?.projectId ?? inbox?.id ?? "",
  );
  const [repeatBase, setRepeatBase] = useState<RoutineRepeatBase>(
    routine?.repeatBase ?? "scheduled",
  );
  const [repeatEvery, setRepeatEvery] = useState(
    String(routine?.repeatEvery ?? 1),
  );
  const [repeatUnit, setRepeatUnit] = useState<RoutineRepeatUnit>(
    routine?.repeatUnit ?? "day",
  );
  // Nothing ticked means "the day this routine is anchored to" — the start date
  // on edit, today on create (the server anchors new routines to the local day).
  const [repeatWeekdays, setRepeatWeekdays] = useState<number[]>(() => {
    if (routine?.repeatWeekdays.length) return routine.repeatWeekdays;
    return [weekdayOf(routine ? routine.startDate : todayStr(tz))];
  });
  const [endsMode, setEndsMode] = useState<"never" | "on">(
    routine?.endDate ? "on" : "never",
  );
  const [endDate, setEndDate] = useState(routine?.endDate ?? "");

  // "Every weekday" means Mon-Fri and nothing else, so the count is pinned to 1.
  const everyLocked = repeatUnit === "weekday";
  const showWeekdays = repeatUnit === "week" && repeatBase === "scheduled";

  const everyNum = Number(repeatEvery);
  const everyInvalid =
    !Number.isInteger(everyNum) ||
    everyNum < 1 ||
    everyNum > MAX_EVERY[repeatUnit];
  const weekdaysInvalid = showWeekdays && repeatWeekdays.length === 0;
  const endsInvalid = endsMode === "on" && !endDate;
  const invalid =
    !content.trim() || everyInvalid || weekdaysInvalid || endsInvalid;

  function changeUnit(unit: RoutineRepeatUnit) {
    setRepeatUnit(unit);
    if (unit === "weekday") setRepeatEvery("1");
  }

  function toggleWeekday(day: number, checked: boolean) {
    setRepeatWeekdays((days) =>
      checked ? [...days, day].sort() : days.filter((d) => d !== day),
    );
  }

  function save() {
    if (invalid) return;
    const common = {
      content: content.trim(),
      description: description.trim() ? description.trim() : null,
      priority: Number(priority),
      projectId,
      repeatEvery: everyNum,
      repeatUnit,
      repeatWeekdays: showWeekdays ? repeatWeekdays : [],
      repeatBase,
      endDate: endsMode === "on" ? endDate : null,
    };
    // Close only once the write lands. A failed save keeps the dialog open with
    // the user's input intact rather than pretending it saved (the hooks toast
    // the error) — a silent close hid a real server bug during development.
    const onSuccess = () => onOpenChange(false);
    if (routine) {
      update.mutate({ id: routine.id, input: common }, { onSuccess });
    } else {
      create.mutate(common, { onSuccess });
    }
  }

  const saving = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{routine ? "Edit routine" : "New routine"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="routine-content">Title</Label>
            <Input
              id="routine-content"
              autoFocus
              value={content}
              placeholder="e.g. Stretch for 10 minutes"
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="routine-description">Description</Label>
            <Textarea
              id="routine-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2 border-t pt-4">
            <Label className="font-semibold">Based on</Label>
            <RadioGroup
              className="gap-2"
              value={repeatBase}
              onValueChange={(v) => setRepeatBase(v as RoutineRepeatBase)}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="scheduled" id="base-scheduled" />
                <Label htmlFor="base-scheduled" className="font-normal">
                  Scheduled date
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="completed" id="base-completed" />
                <Label htmlFor="base-completed" className="font-normal">
                  Completed date
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="repeat-every" className="font-semibold">
              Every
            </Label>
            <div className="flex items-center gap-3">
              <Input
                id="repeat-every"
                type="number"
                min={1}
                max={MAX_EVERY[repeatUnit]}
                disabled={everyLocked}
                className="w-20"
                aria-invalid={everyInvalid || undefined}
                value={repeatEvery}
                onChange={(e) => setRepeatEvery(e.target.value)}
              />
              <Select
                value={repeatUnit}
                onValueChange={(v) => changeUnit(v as RoutineRepeatUnit)}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPEAT_UNITS.map((u) => (
                    <SelectItem key={u.value} value={u.value}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {everyInvalid && (
              <p className="text-xs text-red-600">
                Enter a whole number from 1 to {MAX_EVERY[repeatUnit]}.
              </p>
            )}
          </div>

          {showWeekdays && (
            <div className="grid gap-2">
              <Label className="font-semibold">On</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {WEEKDAYS.map((d) => (
                  <div key={d.value} className="flex items-center gap-2">
                    <Checkbox
                      id={`weekday-${d.value}`}
                      aria-invalid={weekdaysInvalid || undefined}
                      checked={repeatWeekdays.includes(d.value)}
                      onCheckedChange={(c) => toggleWeekday(d.value, c === true)}
                    />
                    <Label htmlFor={`weekday-${d.value}`} className="font-normal">
                      {d.label}
                    </Label>
                  </div>
                ))}
              </div>
              {weekdaysInvalid && (
                <p className="text-xs text-red-600">Pick at least one day.</p>
              )}
            </div>
          )}

          <div className="grid gap-2">
            <Label className="font-semibold">Ends</Label>
            <RadioGroup
              className="gap-2"
              value={endsMode}
              onValueChange={(v) => setEndsMode(v as "never" | "on")}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="never" id="ends-never" />
                <Label htmlFor="ends-never" className="font-normal">
                  Never
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="on" id="ends-mode-on" />
                <Label htmlFor="ends-mode-on" className="font-normal">
                  On date
                </Label>
                {endsMode === "on" && (
                  <Input
                    id="ends-on"
                    type="date"
                    className="ml-1 w-40"
                    aria-label="End date (inclusive)"
                    aria-invalid={endsInvalid || undefined}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                )}
              </div>
            </RadioGroup>
          </div>

          <p className="text-muted-foreground text-xs">
            An unfinished routine task carries over to the next day.
          </p>
          {routine && (
            <p className="text-muted-foreground text-xs">
              Changes apply to future days — today’s task keeps its current
              values.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={invalid || saving}>
            {routine ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

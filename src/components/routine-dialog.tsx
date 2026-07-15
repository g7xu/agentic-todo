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
import { useCreateRoutine, useUpdateRoutine } from "@/hooks/use-routines";
import type { ProjectDTO, RoutineDTO, RoutineRepeatBase } from "@/lib/types";

const PRIORITIES = [
  { value: "1", label: "P1 — Urgent" },
  { value: "2", label: "P2 — High" },
  { value: "3", label: "P3 — Medium" },
  { value: "4", label: "P4 — None" },
];

const REPEAT_BASE = [
  { value: "scheduled", label: "Scheduled date" },
  { value: "completed", label: "Completed date" },
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
  const [endsMode, setEndsMode] = useState<"never" | "on">(
    routine?.endDate ? "on" : "never",
  );
  const [endDate, setEndDate] = useState(routine?.endDate ?? "");

  const everyNum = Number(repeatEvery);
  const everyInvalid =
    !Number.isInteger(everyNum) || everyNum < 1 || everyNum > 365;
  const endsInvalid = endsMode === "on" && !endDate;

  function save() {
    if (!content.trim() || everyInvalid || endsInvalid) return;
    const common = {
      content: content.trim(),
      description: description.trim() ? description.trim() : null,
      priority: Number(priority),
      projectId,
      repeatEvery: everyNum,
      repeatBase,
      endDate: endsMode === "on" ? endDate : null,
    };
    if (routine) {
      update.mutate({ id: routine.id, input: common });
    } else {
      create.mutate(common);
    }
    onOpenChange(false);
  }

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
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Repeat based on</Label>
              <Select
                value={repeatBase}
                onValueChange={(v) => setRepeatBase(v as RoutineRepeatBase)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPEAT_BASE.map((b) => (
                    <SelectItem key={b.value} value={b.value}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="repeat-every">Every</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="repeat-every"
                  type="number"
                  min={1}
                  max={365}
                  className="w-20"
                  aria-invalid={everyInvalid || undefined}
                  value={repeatEvery}
                  onChange={(e) => setRepeatEvery(e.target.value)}
                />
                <span className="text-muted-foreground text-sm">
                  {everyNum === 1 ? "day" : "days"}
                </span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Ends</Label>
              <Select
                value={endsMode}
                onValueChange={(v) => setEndsMode(v as "never" | "on")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Never</SelectItem>
                  <SelectItem value="on">On date (inclusive)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {endsMode === "on" && (
              <div className="grid gap-1.5">
                <Label htmlFor="ends-on">End date</Label>
                <Input
                  id="ends-on"
                  type="date"
                  aria-invalid={endsInvalid || undefined}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            )}
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
          <Button
            onClick={save}
            disabled={!content.trim() || everyInvalid || endsInvalid}
          >
            {routine ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

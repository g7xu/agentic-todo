"use client";

import { useState, type KeyboardEvent } from "react";
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
import { Check, Hourglass } from "lucide-react";
import { useCompleteTask, useUpdateTask } from "@/hooks/use-tasks";
import { DurationPicker } from "@/components/duration-picker";
import { insertNewlineAtCursor } from "@/lib/textarea";
import type { ProjectDTO, TaskDTO } from "@/lib/types";

const PRIORITIES = [
  { value: "1", label: "P1 — Urgent" },
  { value: "2", label: "P2 — High" },
  { value: "3", label: "P3 — Medium" },
  { value: "4", label: "P4 — None" },
];

export function EditTaskDialog({
  task,
  projects,
  open,
  onOpenChange,
}: {
  task: TaskDTO;
  projects: ProjectDTO[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateTask();
  const complete = useCompleteTask();
  const [content, setContent] = useState(task.content);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState(String(task.priority));
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [deadline, setDeadline] = useState(task.deadline ?? "");
  const [estimate, setEstimate] = useState(task.estimate);
  const [timeUsed, setTimeUsed] = useState(task.timeUsed);
  const [projectId, setProjectId] = useState(task.projectId);

  // A routine row records one routine on one day, so its date and project are
  // fixed. The server rejects a change to either; both fields are read-only.
  const isRoutineDay = task.routineId !== null;

  function edits() {
    return {
      id: task.id,
      input: {
        content: content.trim(),
        description: description.trim() ? description.trim() : null,
        priority: Number(priority),
        ...(isRoutineDay
          ? {}
          : { dueDate: dueDate ? dueDate : null, projectId }),
        deadline: deadline ? deadline : null,
        estimate,
        timeUsed,
      },
    };
  }

  function save() {
    if (!content.trim()) return;
    update.mutate(edits());
    onOpenChange(false);
  }

  // Logging time used and ticking the task off is one action in practice, so
  // the dialog offers it as one button. The edits land first — completing a
  // task that then fails to save would strand the time used.
  async function saveAndComplete() {
    if (!content.trim()) return;
    onOpenChange(false);
    try {
      await update.mutateAsync(edits());
    } catch {
      return;
    }
    complete.mutate(task.id);
  }

  // Enter saves; Cmd/Ctrl+Enter inserts a newline (Shift+Enter keeps the
  // textarea's native newline behavior).
  function onDescriptionKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter") return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      insertNewlineAtCursor(e.currentTarget, setDescription);
    } else if (!e.shiftKey) {
      e.preventDefault();
      save();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="content">Title</Label>
            <Input
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              placeholder="⌘⏎ for a new line"
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={onDescriptionKeyDown}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="due">Due date</Label>
              <Input
                id="due"
                type="date"
                value={dueDate}
                disabled={isRoutineDay}
                title={isRoutineDay ? "Routine — the date is fixed" : undefined}
                onChange={(e) => setDueDate(e.target.value)}
              />
              {isRoutineDay && (
                <p className="text-muted-foreground text-xs">
                  Routine — the date and project are fixed.
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="deadline">Deadline</Label>
              {/* The hard date — editable on any task, routine days
                  included; only the planned date beside it is locked for those. */}
              <Input
                id="deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Estimate</Label>
              <DurationPicker
                value={estimate}
                onChange={setEstimate}
                placeholder="Estimate"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Time used</Label>
              <DurationPicker
                value={timeUsed}
                onChange={setTimeUsed}
                placeholder="Time used"
                icon={Hourglass}
                // Actuals keep the looser pre-existing bound; only estimates are
                // capped at 24h (docs/ESTIMATES.md DE3).
                max={5999}
                clearLabel="Clear time used"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Project</Label>
              <Select
                value={projectId}
                onValueChange={setProjectId}
                disabled={isRoutineDay}
              >
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
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {task.status === "active" && (
            <Button variant="secondary" onClick={saveAndComplete}>
              <Check className="size-4" /> Save &amp; complete
            </Button>
          )}
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

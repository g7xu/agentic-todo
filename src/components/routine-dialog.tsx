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
import type { ProjectDTO, RoutineDTO } from "@/lib/types";

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

  const [content, setContent] = useState(routine?.content ?? "");
  const [description, setDescription] = useState(routine?.description ?? "");
  const [priority, setPriority] = useState(String(routine?.priority ?? 4));
  const [projectId, setProjectId] = useState(
    routine?.projectId ?? inbox?.id ?? "",
  );

  function save() {
    if (!content.trim()) return;
    const common = {
      content: content.trim(),
      description: description.trim() ? description.trim() : null,
      priority: Number(priority),
      projectId,
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
          <Button onClick={save} disabled={!content.trim()}>
            {routine ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

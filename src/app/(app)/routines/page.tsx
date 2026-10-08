"use client";

import { useState } from "react";
import {
  Clock,
  Flag,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RoutineDialog } from "@/components/routine-dialog";
import { formatDuration } from "@/lib/duration";
import { cadenceLabel } from "@/lib/repeat";
import {
  useDeleteRoutine,
  useRoutines,
  useUpdateRoutine,
} from "@/hooks/use-routines";
import { useProjects } from "@/hooks/use-projects";
import type { RoutineDTO } from "@/lib/types";

const PRIORITY_COLOR: Record<number, string> = {
  1: "text-red-500",
  2: "text-orange-500",
  3: "text-blue-500",
  4: "",
};

export default function RoutinesPage() {
  const { data: routines = [], isLoading, isError, refetch } = useRoutines();
  const { data: projects = [] } = useProjects();
  const update = useUpdateRoutine();
  const del = useDeleteRoutine();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RoutineDTO | null>(null);
  const [deleting, setDeleting] = useState<RoutineDTO | null>(null);

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Routines</h1>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> New routine
        </Button>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">
        Repeating tasks. Each occurrence shows up in Today on its day.
      </p>

      <div className="overflow-hidden rounded-lg border">
        {isError && (
          <div className="px-3 py-8 text-sm">
            <span className="text-red-600">Couldn&apos;t load routines.</span>{" "}
            <button className="underline" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        )}
        {!isError && routines.length === 0 && (
          <div className="text-muted-foreground px-3 py-8 text-center text-sm">
            {isLoading ? "Loading…" : "No routines yet. Create one to start."}
          </div>
        )}
        {routines.map((r) => {
          const project = projects.find((p) => p.id === r.projectId);
          return (
            <div
              key={r.id}
              className="group hover:bg-accent/40 flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
            >
              <Repeat
                className={cn(
                  "size-4 shrink-0",
                  r.active ? "text-muted-foreground" : "text-muted-foreground/40",
                )}
              />
              {r.priority < 4 && (
                <Flag
                  className={cn(
                    "size-3.5 shrink-0",
                    PRIORITY_COLOR[r.priority],
                  )}
                />
              )}
              <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                <span
                  className={cn(
                    "truncate text-sm",
                    !r.active && "text-muted-foreground",
                  )}
                >
                  {r.content}
                  {!r.active && " (paused)"}
                </span>
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <span className="whitespace-nowrap">{cadenceLabel(r)}</span>
                  {r.estimate !== null && (
                    <span className="flex items-center gap-0.5" title="Estimated">
                      <Clock className="size-3" />
                      {formatDuration(r.estimate)}
                    </span>
                  )}
                  {project && !project.isInbox && (
                    <span className="max-w-full truncate"># {project.name}</span>
                  )}
                </div>
              </div>
              <button
                aria-label={r.active ? "Pause routine" : "Resume routine"}
                title={r.active ? "Pause" : "Resume"}
                className="hover:bg-accent rounded p-1 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                onClick={() =>
                  update.mutate({ id: r.id, input: { active: !r.active } })
                }
              >
                {r.active ? (
                  <Pause className="size-4" />
                ) : (
                  <Play className="size-4" />
                )}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Routine options"
                  className="hover:bg-accent rounded p-1 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditing(r)}>
                    <Pencil className="size-4" /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      update.mutate({ id: r.id, input: { active: !r.active } })
                    }
                  >
                    {r.active ? (
                      <>
                        <Pause className="size-4" /> Pause
                      </>
                    ) : (
                      <>
                        <Play className="size-4" /> Resume
                      </>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleting(r)}
                  >
                    <Trash2 className="size-4" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
      </div>

      {creating && (
        <RoutineDialog
          projects={projects}
          open={creating}
          onOpenChange={setCreating}
        />
      )}
      {editing && (
        <RoutineDialog
          key={editing.id}
          routine={editing}
          projects={projects}
          open={!!editing}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      )}
      {deleting && (
        <Dialog
          open={!!deleting}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete “{deleting.content}”?</DialogTitle>
              <DialogDescription>
                Today’s unfinished task is removed with it. Days you already
                completed (or missed) stay in your history.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  del.mutate(deleting.id);
                  setDeleting(null);
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDeleteProject } from "@/hooks/use-projects";
import type { ProjectDTO } from "@/lib/types";

// No task or routine counts: the client's task cache holds only the newest
// completed rows and no missed routine days, so any count it produced would
// understate what moves.
export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const deleteProject = useDeleteProject();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          {/* pr-6 keeps a long name clear of the close button. wrap-anywhere,
              not wrap-break-word: only it lets an unbroken name shrink the
              dialog's grid column instead of widening it past the screen. */}
          <DialogTitle className="pr-6 wrap-anywhere">
            Delete “{project.name}”?
          </DialogTitle>
          <DialogDescription>
            Its tasks, completed ones included, and its routines will move to
            Inbox. This can’t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              deleteProject.mutate(project.id);
              onOpenChange(false);
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

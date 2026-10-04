"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteAccountAction } from "@/app/actions/account";

const CONFIRM_WORD = "delete";

/** Shown when the data is gone but the sign-in record outlived the request. */
const PARTIAL_MESSAGE = {
  "confirm-by-email":
    "Your tasks, projects and routines are deleted. We emailed you a link; follow it to remove your sign-in as well.",
  "sign-in-kept":
    "Your tasks, projects and routines are deleted, but your sign-in could not be removed. Contact support to finish deleting it.",
} as const;

export function YourData() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [partial, setPartial] = useState<keyof typeof PARTIAL_MESSAGE | null>(
    null,
  );

  function close() {
    setOpen(false);
    setTyped("");
    if (partial) {
      // The session survived, so the app layout re-provisions an empty
      // account on the next render; drop every cached query to match.
      setPartial(null);
      queryClient.invalidateQueries();
      router.refresh();
    }
  }

  function deleteAccount() {
    startTransition(async () => {
      try {
        const outcome = await deleteAccountAction();
        if (outcome === "deleted") {
          // A full load, not router.push: the query cache and the auth UI's
          // in-memory session still describe the deleted account, and only
          // a fresh document drops both.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/");
          return;
        }
        setPartial(outcome);
      } catch {
        toast.error("Could not delete your account. Nothing was deleted.");
      }
    });
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <p className="text-muted-foreground text-sm">
          Download your tasks, projects and routines as a JSON file.
        </p>
        <div>
          <Button variant="outline" size="sm" asChild>
            <a href="/api/account/export" download>
              Download your data
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-2">
        <p className="text-muted-foreground text-sm">
          Permanently delete your account, everything in it, and every app
          connected to it.
        </p>
        <div>
          <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
            Delete account
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(o) => !o && !pending && close()}>
        <DialogContent>
          {partial ? (
            <>
              <DialogHeader>
                <DialogTitle>Account data deleted</DialogTitle>
                <DialogDescription>{PARTIAL_MESSAGE[partial]}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={close}>OK</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Delete your account?</DialogTitle>
                <DialogDescription>
                  This deletes all your tasks, projects and routines,
                  disconnects every connected app, and removes your sign-in.
                  It cannot be undone. Download your data first if you want a
                  copy.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor="confirm-delete">
                  Type <span className="font-mono">{CONFIRM_WORD}</span> to
                  confirm
                </Label>
                <Input
                  id="confirm-delete"
                  autoComplete="off"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  disabled={pending}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={close} disabled={pending}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={deleteAccount}
                  disabled={pending || typed.trim().toLowerCase() !== CONFIRM_WORD}
                >
                  {pending ? "Deleting…" : "Delete account"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

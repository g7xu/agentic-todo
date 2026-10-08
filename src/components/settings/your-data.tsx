"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
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

export function YourData() {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  function close() {
    setOpen(false);
    setTyped("");
  }

  function deleteAccount() {
    startTransition(async () => {
      try {
        await deleteAccountAction();
        // The sign-out page clears the session cookies, then lands on
        // sign-in. A full load, not router.push: the query cache and the
        // auth UI's in-memory session still describe the deleted account.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/auth/sign-out");
      } catch {
        toast.error("Could not delete your account. Nothing was deleted.");
      }
    });
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <p className="text-muted-foreground text-sm">
          Download your tasks, projects and routines as a JSON file. The{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            privacy policy
          </Link>{" "}
          lists everything stored about you.
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
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This deletes all your tasks, projects and routines, disconnects
              every connected app, and removes your sign-in. It cannot be
              undone. Download your data first if you want a copy.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="confirm-delete">
              Type <span className="font-mono">{CONFIRM_WORD}</span> to confirm
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
        </DialogContent>
      </Dialog>
    </div>
  );
}

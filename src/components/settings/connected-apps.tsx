"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { revokeConnectedAppAction } from "@/app/actions/connected-apps";
import type { ConnectedAppDTO } from "@/lib/types";

const SCOPE_LABEL: Record<string, string> = {
  "tasks:read": "read",
  "tasks:write": "write",
};

function formatDay(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * The OAuth grants behind Settings → Connected apps. Revoking is immediate
 * and server-side: the app's next request fails with 401 and it has to go
 * through consent again.
 */
export function ConnectedApps({
  apps,
  mcpUrl,
}: {
  apps: ConnectedAppDTO[];
  mcpUrl: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<ConnectedAppDTO | null>(null);

  function revoke(app: ConnectedAppDTO) {
    startTransition(async () => {
      try {
        const removed = await revokeConnectedAppAction(app.id);
        toast(removed ? `Disconnected ${app.name}` : "Already disconnected");
      } catch {
        toast.error("Could not disconnect");
      } finally {
        setTarget(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-3">
      <p className="text-muted-foreground text-sm">
        Apps that can read and change your tasks through MCP. Connect one by
        giving it <span className="font-mono">{mcpUrl}</span>.
      </p>

      {apps.length === 0 ? (
        <p className="text-muted-foreground text-sm">No apps connected.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {apps.map((app) => (
            <li
              key={app.id}
              className="flex items-center justify-between gap-4 p-3"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{app.name}</div>
                <div className="text-muted-foreground text-xs">
                  {app.host ? (
                    <span className="font-mono">{app.host}</span>
                  ) : (
                    "registered directly"
                  )}
                  {" · "}
                  {app.scopes.map((s) => SCOPE_LABEL[s] ?? s).join(" + ")}
                  {" · connected "}
                  {formatDay(app.createdAt)}
                  {" · last used "}
                  {formatDay(app.lastUsedAt)}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setTarget(app)}
              >
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {target?.name}?</DialogTitle>
            <DialogDescription>
              It loses access immediately. You can connect it again later by
              approving it afresh.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Keep
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => target && revoke(target)}
            >
              {pending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

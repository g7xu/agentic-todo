"use server";

import { requireUser } from "@/lib/auth/session";
import { listGrants, revokeGrant } from "@/lib/oauth/store";
import type { ConnectedAppDTO } from "@/lib/types";
import { idSchema } from "@/lib/validation/projects";

export async function listConnectedAppsAction(): Promise<ConnectedAppDTO[]> {
  const user = await requireUser();
  return listGrants(user.id);
}

/** Resolves false when the grant was not the caller's or was already gone. */
export async function revokeConnectedAppAction(
  grantId: string,
): Promise<boolean> {
  const user = await requireUser();
  return revokeGrant(user.id, idSchema.parse(grantId));
}

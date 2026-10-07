"use server";

import { requireUser } from "@/lib/auth/session";
import { deleteAccount } from "@/lib/data/account";

/**
 * Deletes the caller's account. If this rejects, nothing was deleted.
 *
 * Cookies are left for the client to clear by visiting the sign-out page:
 * changing one here makes Next re-render the current layout in the same
 * response, and that render would still see the deleted user's cached
 * session.
 */
export async function deleteAccountAction(): Promise<void> {
  const user = await requireUser();
  await deleteAccount(user.id);
}

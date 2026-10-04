"use server";

import {
  classifyAuthDeletion,
  type AuthDeletionOutcome,
  type AuthDeletionResult,
} from "@/lib/auth/account-deletion";
import { auth } from "@/lib/auth/server";
import { requireUser } from "@/lib/auth/session";
import { deleteAccountData } from "@/lib/data/account";

/**
 * Deletes the caller's app data, then their Neon Auth user.
 *
 * App data goes first, in one transaction. The reverse order could strand
 * it: once the auth user is gone the owner can never sign in again to
 * retry, and a failed data delete would leave tasks no one can see or
 * remove. Deleted in this order, the worst case is a sign-in record with
 * no data behind it, which is reported to the user and logged.
 *
 * A throw from the auth call is folded into `sign-in-kept`, so when this
 * action rejects, nothing was deleted.
 */
export async function deleteAccountAction(): Promise<AuthDeletionOutcome> {
  const user = await requireUser();
  await deleteAccountData(user.id);

  let result: AuthDeletionResult;
  try {
    result = await auth.deleteUser();
  } catch (error) {
    result = { data: null, error };
  }
  const outcome = classifyAuthDeletion(result);
  if (outcome === "sign-in-kept") {
    console.error("deleteAccount: app data deleted, auth user kept", {
      userId: user.id,
      error: result.error,
    });
  }
  return outcome;
}

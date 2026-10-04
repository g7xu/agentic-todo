/**
 * What became of the sign-in record after a delete-account request:
 * - `deleted`: the auth user and its sessions are gone.
 * - `confirm-by-email`: the auth service mailed a confirmation link instead,
 *   and the user disappears only when it is followed.
 * - `sign-in-kept`: the auth service refused, e.g. deletion is disabled for
 *   the project, so the user can still sign in.
 */
export type AuthDeletionOutcome = "deleted" | "confirm-by-email" | "sign-in-kept";

/** The `{ data, error }` envelope every Neon Auth server method resolves to. */
export type AuthDeletionResult = {
  data: { message?: string } | null;
  error: unknown;
};

/** The message Better Auth answers with when it mails a confirmation link. */
const VERIFICATION_SENT = "Verification email sent";

export function classifyAuthDeletion(
  result: AuthDeletionResult,
): AuthDeletionOutcome {
  if (result.error || !result.data) return "sign-in-kept";
  return result.data.message === VERIFICATION_SENT
    ? "confirm-by-email"
    : "deleted";
}

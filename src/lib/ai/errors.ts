/** True when the AI provider rejected the call for quota / rate-limit reasons. */
export function isQuotaError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /quota|exceeded|resource_exhausted|rate.?limit|too many requests|\b429\b/i.test(
    msg,
  );
}

/** A user-facing message for an AI failure (distinguishes rate limits). */
export function aiErrorMessage(error: unknown): string {
  return isQuotaError(error)
    ? "The free AI tier is rate-limited right now — wait ~30 seconds and try again."
    : "Something went wrong with the assistant. Please try again.";
}

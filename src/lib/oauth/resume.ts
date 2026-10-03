/**
 * Carrying an authorization request through sign-in. Neon Auth validates the
 * post-login `redirectTo` as a "safe relative path" and rejects the raw OAuth
 * query string (a `+` between scopes is enough to trip INVALID_CALLBACKURL),
 * so the request travels as one base64url parameter:
 * `/oauth/authorize?r=<encoded query>`. The authorize page decodes it and
 * re-enters with the original parameters, which are then validated as usual.
 */

export const RESUME_PARAM = "r";
export const AUTHORIZE_PATH = "/oauth/authorize";

/** Only characters base64url produces; anything else is not ours. */
const RESUME_RE = /^[A-Za-z0-9_-]{1,4096}$/;

/** `query` is the search string without its leading `?`. */
export function resumeUrl(query: string): string {
  const encoded = Buffer.from(query, "utf8").toString("base64url");
  return `${AUTHORIZE_PATH}?${RESUME_PARAM}=${encoded}`;
}

/**
 * The relative authorize URL to re-enter with, or null when the value is not
 * a resume token this server produced. The result is always a path under
 * AUTHORIZE_PATH, never an absolute URL.
 */
export function decodeResume(value: string): string | null {
  if (!RESUME_RE.test(value)) return null;
  const query = Buffer.from(value, "base64url").toString("utf8");
  if (query === "" || /[\s\u0000-\u001f#]/.test(query)) return null;
  return `${AUTHORIZE_PATH}?${query}`;
}

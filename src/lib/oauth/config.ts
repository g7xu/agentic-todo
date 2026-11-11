/**
 * Constants for the in-app OAuth 2.1 authorization server (docs/MCP.md §3).
 *
 * The issuer is pinned by `APP_URL` rather than derived from request headers:
 * the protected-resource document's `resource` must equal the URL users type
 * into their MCP client byte for byte, and a Host header is attacker-chosen.
 */

const DEV_ISSUER = "http://localhost:3000";

/**
 * Resolution order: `APP_URL` when set; on a Vercel preview deployment the
 * deployment's own URL, since every preview has a different one and no fixed
 * value could be right; a hard failure in production, where a wrong issuer
 * would make every discovery document lie; the Next.js default port in dev.
 */
export function issuer(): string {
  const configured = process.env.APP_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "APP_URL is not set; it is the OAuth issuer and must match the public URL",
    );
  }
  return DEV_ISSUER;
}

/** RFC 8707 resource identifier of the MCP endpoint. */
export function resourceUrl(): string {
  return `${issuer()}/api/mcp`;
}

/**
 * `tasks:agent` is the agent hand-off alone (docs/AGENT-TASKS.md AT7): claim,
 * log, ask, release, finish and suggest, with no general edits and no
 * deletes. Everything it allows, `tasks:write` allows too, so swapping write
 * for agent on the consent page only ever narrows a grant.
 */
export const SCOPES = ["tasks:read", "tasks:write", "tasks:agent"] as const;
export type Scope = (typeof SCOPES)[number];
export const SCOPE_STRING: string = SCOPES.join(" ");
/** What a request that names no scope gets: full access, as before tasks:agent existed. */
export const DEFAULT_SCOPES: readonly Scope[] = ["tasks:read", "tasks:write"];

/**
 * The scopes granted when the user ticks "agent hand-off only" on the
 * consent page: `tasks:write` is replaced by `tasks:agent`. A request
 * without write is returned unchanged.
 */
export function narrowToAgent(scopes: readonly Scope[]): Scope[] {
  if (!scopes.includes("tasks:write")) return [...scopes];
  const out = scopes.filter((s) => s !== "tasks:write");
  if (!out.includes("tasks:agent")) out.push("tasks:agent");
  return out;
}

export const CODE_TTL_MS = 10 * 60 * 1000;
export const ACCESS_TTL_S = 60 * 60;
/** Sliding: each refresh issues a new token with a fresh 30-day window. */
export const REFRESH_TTL_S = 30 * 24 * 60 * 60;

/** A cached CIMD document is reused without a fetch inside this window … */
export const CIMD_FRESH_MS = 60 * 60 * 1000;
/** … and is still accepted after a failed refetch up to this age. */
export const CIMD_STALE_MAX_MS = 24 * 60 * 60 * 1000;

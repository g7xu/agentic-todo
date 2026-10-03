/**
 * Constants for the in-app OAuth 2.1 authorization server (docs/MCP.md §3).
 *
 * The issuer is pinned by `APP_URL` rather than derived from request headers:
 * the protected-resource document's `resource` must equal the URL users type
 * into their MCP client byte for byte, and a Host header is attacker-chosen.
 */

const DEV_ISSUER = "http://localhost:3000";

export function issuer(): string {
  const configured = process.env.APP_URL?.replace(/\/+$/, "");
  if (configured) return configured;
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

export const SCOPES = ["tasks:read", "tasks:write"] as const;
export type Scope = (typeof SCOPES)[number];
/** Every grant carries the full set in v1; consent has no partial option. */
export const SCOPE_STRING: string = SCOPES.join(" ");

export const CODE_TTL_MS = 10 * 60 * 1000;
export const ACCESS_TTL_S = 60 * 60;
/** Sliding: each refresh issues a new token with a fresh 30-day window. */
export const REFRESH_TTL_S = 30 * 24 * 60 * 60;

/** A cached CIMD document is reused without a fetch inside this window … */
export const CIMD_FRESH_MS = 60 * 60 * 1000;
/** … and is still accepted after a failed refetch up to this age. */
export const CIMD_STALE_MAX_MS = 24 * 60 * 60 * 1000;

import { z } from "zod";
import { SCOPES, type Scope } from "@/lib/oauth/config";
import { OAuthError } from "@/lib/oauth/errors";
import { isValidCodeChallenge } from "@/lib/oauth/pkce";

/**
 * The authorization request as it arrives on `/oauth/authorize`. S256 is the
 * only accepted challenge method: `plain` is absent on purpose, not pending.
 */
export const authorizeRequestSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(2048),
  redirect_uri: z.string().min(1).max(2048),
  state: z.string().max(1024).optional(),
  scope: z.string().max(256).optional(),
  code_challenge: z.string().refine(isValidCodeChallenge, "malformed"),
  code_challenge_method: z.literal("S256"),
  resource: z.string().max(2048).optional(),
});

export type AuthorizeRequest = z.infer<typeof authorizeRequestSchema>;

type Params = Record<string, string | string[] | undefined>;

/** Repeated query parameters are an error, never silently first-wins. */
export function parseAuthorizeRequest(params: Params): AuthorizeRequest {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      throw new OAuthError("invalid_request", `duplicate parameter: ${k}`);
    }
    if (v !== undefined) flat[k] = v;
  }
  const result = authorizeRequestSchema.safeParse(flat);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.join(".") || "request";
    throw new OAuthError("invalid_request", `${where}: ${issue?.message}`);
  }
  return result.data;
}

/**
 * Scopes the client asked for, as a subset of SCOPES. An absent `scope`
 * means everything. `offline_access` is dropped rather than rejected because
 * clients add it whenever an authorization server lists it, and refresh
 * tokens are issued unconditionally here.
 */
export function parseRequestedScopes(scope: string | undefined): Scope[] {
  if (scope === undefined || scope.trim() === "") return [...SCOPES];
  const known = new Set<string>(SCOPES);
  const out: Scope[] = [];
  for (const s of scope.split(/\s+/).filter(Boolean)) {
    if (s === "offline_access") continue;
    if (!known.has(s)) {
      throw new OAuthError("invalid_scope", `unknown scope: ${s}`);
    }
    if (!out.includes(s as Scope)) out.push(s as Scope);
  }
  if (out.length === 0) return [...SCOPES];
  return out;
}

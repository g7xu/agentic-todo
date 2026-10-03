import { z } from "zod";
import { OAuthError } from "@/lib/oauth/errors";
import { isRegistrableRedirectUri } from "@/lib/oauth/redirect-uri";

/**
 * Client ID Metadata Documents (draft-ietf-oauth-client-id-metadata-document):
 * a client identifies itself with an https URL that serves its own metadata.
 * The pure checks live here; fetching and caching are in `cimd.ts`.
 */

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost"];

/**
 * Whether a client_id URL may be fetched at all. The server will issue a
 * request to this address on a user's behalf, so anything that could point
 * inside the deployment's own network is refused before any lookup.
 */
export function isAllowedCimdUrl(clientId: string): boolean {
  let u: URL;
  try {
    u = new URL(clientId);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.username !== "" || u.password !== "" || u.hash !== "") return false;
  const host = u.hostname;
  if (host === "" || host === "localhost") return false;
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return false;
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return false;
  return true;
}

const documentSchema = z.object({
  client_id: z.string(),
  client_name: z.string().max(100).optional(),
  redirect_uris: z.array(z.string()).min(1).max(20),
  token_endpoint_auth_method: z.literal("none").optional(),
});

export type ClientMetadata = {
  clientName: string | null;
  redirectUris: string[];
};

/**
 * Validates a fetched document against the URL it was fetched from. The
 * `client_id` inside must equal that URL exactly; this is what stops one
 * document from claiming another client's identity.
 */
export function validateClientMetadataDocument(
  doc: unknown,
  url: string,
): ClientMetadata {
  const parsed = documentSchema.safeParse(doc);
  if (!parsed.success) {
    throw new OAuthError("invalid_client", "client metadata document is malformed");
  }
  const d = parsed.data;
  if (d.client_id !== url) {
    throw new OAuthError("invalid_client", "client_id does not match document URL");
  }
  if (!d.redirect_uris.every(isRegistrableRedirectUri)) {
    throw new OAuthError("invalid_client", "redirect_uris must be https or loopback http");
  }
  return { clientName: d.client_name ?? null, redirectUris: d.redirect_uris };
}

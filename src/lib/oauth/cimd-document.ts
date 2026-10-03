import { z } from "zod";
import { OAuthError } from "@/lib/oauth/errors";
import { isRegistrableRedirectUri } from "@/lib/oauth/redirect-uri";

/**
 * Client ID Metadata Documents (draft-ietf-oauth-client-id-metadata-document):
 * a client identifies itself with an https URL that serves its own metadata.
 * The pure checks live here; fetching and caching are in `cimd.ts`.
 */

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost", ".arpa"];

/**
 * Whether a client_id URL may be fetched at all: public https on the default
 * port, with a DNS name rather than an address. This is the lexical gate; the
 * resolved address is checked again in `cimd.ts` before connecting.
 */
export function isAllowedCimdUrl(clientId: string): boolean {
  let u: URL;
  try {
    u = new URL(clientId);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.port !== "") return false;
  if (u.username !== "" || u.password !== "" || u.hash !== "") return false;
  const host = u.hostname.replace(/\.$/, "");
  if (host === "" || host === "localhost" || !host.includes(".")) return false;
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return false;
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return false;
  return true;
}

function ipv4Octets(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? o : null;
}

/**
 * Whether a resolved address is routable on the public internet. Everything
 * reserved, private, loopback, link-local, carrier-NAT, multicast or
 * documentation-only is refused, in both address families, including IPv4
 * addresses mapped into IPv6.
 */
export function isPublicAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isPublicAddress(mapped[1]);

  const v4 = ipv4Octets(ip);
  if (v4) {
    const [a, b] = v4;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a >= 224) return false;
    return true;
  }

  const v6 = ip.toLowerCase();
  if (!v6.includes(":")) return false;
  if (v6 === "::" || v6 === "::1") return false;
  if (/^f[cd]/.test(v6)) return false; // fc00::/7 unique local
  if (/^fe[89ab]/.test(v6)) return false; // fe80::/10 link local
  if (v6.startsWith("64:ff9b:")) return false; // NAT64 well-known prefix
  if (v6.startsWith("2001:db8:")) return false; // documentation
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

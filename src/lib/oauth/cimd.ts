import {
  isAllowedCimdUrl,
  validateClientMetadataDocument,
} from "@/lib/oauth/cimd-document";
import { CIMD_FRESH_MS, CIMD_STALE_MAX_MS } from "@/lib/oauth/config";
import { OAuthError } from "@/lib/oauth/errors";
import { getClient, upsertCimdClient, type OAuthClient } from "@/lib/oauth/store";

const FETCH_TIMEOUT_MS = 5000;
const MAX_DOCUMENT_BYTES = 64 * 1024;

async function fetchDocument(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new OAuthError("invalid_client", `client metadata returned ${res.status}`);
  }
  const declared = Number(res.headers.get("content-length"));
  if (declared > MAX_DOCUMENT_BYTES) {
    throw new OAuthError("invalid_client", "client metadata document too large");
  }
  const text = await res.text();
  if (text.length > MAX_DOCUMENT_BYTES) {
    throw new OAuthError("invalid_client", "client metadata document too large");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new OAuthError("invalid_client", "client metadata is not JSON");
  }
}

/**
 * Resolves a CIMD client_id to a stored client, fetching the document when
 * the cached copy is older than CIMD_FRESH_MS and tolerating a failed refetch
 * until CIMD_STALE_MAX_MS. Callers must have a signed-in user before calling:
 * this is the only place the server fetches a caller-chosen URL.
 */
export async function resolveCimdClient(clientId: string): Promise<OAuthClient> {
  if (!isAllowedCimdUrl(clientId)) {
    throw new OAuthError("invalid_client", "client_id must be a public https URL");
  }
  const cached = await getClient(clientId);
  const age = cached?.fetchedAt
    ? Date.now() - cached.fetchedAt.getTime()
    : Number.POSITIVE_INFINITY;
  if (cached && age < CIMD_FRESH_MS) return cached;

  try {
    const doc = await fetchDocument(clientId);
    const meta = validateClientMetadataDocument(doc, clientId);
    return await upsertCimdClient(clientId, meta, doc);
  } catch (e) {
    if (cached && age < CIMD_STALE_MAX_MS) return cached;
    if (e instanceof OAuthError) throw e;
    throw new OAuthError(
      "invalid_client",
      "client metadata document could not be fetched",
    );
  }
}

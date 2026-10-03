import { lookup } from "node:dns/promises";
import {
  isAllowedCimdUrl,
  isPublicAddress,
  validateClientMetadataDocument,
} from "@/lib/oauth/cimd-document";
import { CIMD_FRESH_MS, CIMD_STALE_MAX_MS } from "@/lib/oauth/config";
import { OAuthError } from "@/lib/oauth/errors";
import { getClient, upsertCimdClient, type OAuthClient } from "@/lib/oauth/store";

const FETCH_TIMEOUT_MS = 5000;
const MAX_DOCUMENT_BYTES = 64 * 1024;

/**
 * Every failure surfaces as this one message. The real reason goes to the
 * server log: distinct messages would let a caller use the fetch as a probe
 * of what the server can reach.
 */
const unusable = () =>
  new OAuthError("invalid_client", "client metadata document could not be used");

class FetchRefused extends Error {}

/**
 * Resolves the name and refuses to connect unless every address is public.
 * The connection itself still re-resolves (a rebinding window remains), so
 * this is a strong filter rather than a guarantee; the document must also
 * echo the exact URL as its `client_id`, which an internal service will not.
 */
async function assertPublicHost(hostname: string): Promise<void> {
  const addresses = await lookup(hostname.replace(/\.$/, ""), { all: true });
  if (addresses.length === 0) throw new FetchRefused("no address");
  for (const a of addresses) {
    if (!isPublicAddress(a.address)) {
      throw new FetchRefused(`resolves to non-public address ${a.address}`);
    }
  }
}

async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > MAX_DOCUMENT_BYTES) throw new FetchRefused("declared too large");
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_DOCUMENT_BYTES) {
      await reader.cancel();
      throw new FetchRefused("body too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Exported for the test that pins the no-redirect and size-cap behaviour. */
export async function fetchDocument(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new FetchRefused(`status ${res.status}`);
  const text = await readCapped(res);
  try {
    return JSON.parse(text);
  } catch {
    throw new FetchRefused("not JSON");
  }
}

/**
 * Resolves a CIMD client_id to a stored client, fetching the document when
 * the cached copy is older than CIMD_FRESH_MS and tolerating a failed refetch
 * until CIMD_STALE_MAX_MS. Callers must have a signed-in user before calling:
 * this is the only place the server fetches a caller-chosen URL.
 */
export async function resolveCimdClient(clientId: string): Promise<OAuthClient> {
  if (!isAllowedCimdUrl(clientId)) throw unusable();
  const cached = await getClient(clientId);
  const age = cached?.fetchedAt
    ? Date.now() - cached.fetchedAt.getTime()
    : Number.POSITIVE_INFINITY;
  if (cached && age < CIMD_FRESH_MS) return cached;

  try {
    await assertPublicHost(new URL(clientId).hostname);
    const doc = await fetchDocument(clientId);
    const meta = validateClientMetadataDocument(doc, clientId);
    return await upsertCimdClient(clientId, meta, doc);
  } catch (e) {
    if (cached && age < CIMD_STALE_MAX_MS) return cached;
    const reason = e instanceof Error ? e.message : String(e);
    console.warn(`CIMD fetch refused for ${new URL(clientId).hostname}: ${reason}`);
    throw unusable();
  }
}

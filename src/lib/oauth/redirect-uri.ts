/** Hostnames a native client may bind on an ephemeral port (RFC 8252 §7.3). */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLoopbackUri(u: URL): boolean {
  return u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname);
}

function parseUrl(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

/**
 * Whether a URI may be registered as a redirect target: absolute, either
 * `https:` or a loopback `http:`, and without a fragment.
 */
export function isRegistrableRedirectUri(s: string): boolean {
  const u = parseUrl(s);
  if (!u || u.hash !== "" || u.username !== "" || u.password !== "") {
    return false;
  }
  return u.protocol === "https:" || isLoopbackUri(u);
}

/** The redirect URI with response parameters appended; undefined values are omitted. */
export function appendParams(
  redirectUri: string,
  params: Record<string, string | undefined>,
): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) u.searchParams.set(k, v);
  }
  return u.toString();
}

/**
 * Exact string match against the registered list, except that loopback
 * redirects match with the port ignored: Claude Code declares
 * `http://localhost/callback` and `http://127.0.0.1/callback` and binds a
 * different port each session. The hostname itself must still be identical
 * (`localhost` never stands in for `127.0.0.1`), as must path and query.
 */
export function redirectUriAllowed(
  registered: readonly string[],
  requested: string,
): boolean {
  if (registered.includes(requested)) return true;

  const req = parseUrl(requested);
  if (!req || !isLoopbackUri(req)) return false;

  return registered.some((r) => {
    const reg = parseUrl(r);
    return (
      reg !== null &&
      isLoopbackUri(reg) &&
      reg.hostname === req.hostname &&
      reg.pathname === req.pathname &&
      reg.search === req.search
    );
  });
}

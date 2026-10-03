# MCP server — Feature Spec & Build Plan

**Owner:** Jason (guoxuan.xu8@gmail.com)
**Status:** Implemented 2026-10-02 (branch `feature/mcp-server`)
**Last updated:** 2026-10-02
Companion docs: [AGENT.md](./AGENT.md) · [PRD.md](./PRD.md) · [TDD.md](./TDD.md) · [DECISIONS.md](./DECISIONS.md)

---

## 1. Summary

The app exposes its task model to Claude (claude.ai, Claude Desktop, Claude Code) as a **remote
MCP server** at `/api/mcp`. There is no in-app chat: Claude is the thinking layer and the web views
hold state (AGENT.md AG1). Every tool is a thin adapter over an existing `src/lib/data` function
(AG4); the user id comes from the verified bearer token and nowhere else.

Because managed Neon Auth cannot host Better Auth plugins, the app is **its own OAuth 2.1
authorization server**. Neon Auth still proves the human; the OAuth layer proves the client and
records the human's consent. The two are separate on purpose and this is the standard shape every
large API uses — the only unusual part is that the authorization server is hand-written rather than
provided by the identity vendor.

### Decisions (owner-decided 2026-10-02)

- **DM1 — Surface: remote MCP, not in-app chat and not local stdio.** Works from every Claude
  surface with one URL; resolves AGENT.md §6 Q1 (DECISIONS D7).
- **DM2 — Client identity: CIMD and DCR, public clients only.** Claude identifies itself with its
  published Client ID Metadata Document; other clients may register dynamically. No client secret
  exists anywhere.
- **DM3 — Scopes `tasks:read` and `tasks:write`; a client receives exactly the subset it asks
  for, never more.** An absent `scope` means both. Consent lists only the requested scopes; the
  write tools refuse a read-only grant. `offline_access` is accepted and ignored; refresh tokens
  are always issued.
- **DM4 — Opaque tokens, hashed at rest.** Access 1 h; refresh 30 d sliding, rotated on every use,
  with a 3 s reuse grace for racing clients; a later replay, or a refresh presented by the wrong
  client, revokes the whole grant.
- **DM5 — Issuer pinned by `APP_URL`,** never derived from request headers.
- **DM6 — `/oauth/authorize` stays behind the Neon middleware; `/oauth/token`, `/oauth/register`
  and `/api/mcp` do not.** The middleware performs the Google OAuth verifier exchange, which the
  authorize page needs; the proxy preserves the OAuth request on its way to sign-in as one
  base64url `redirectTo` parameter (`/oauth/authorize?r=…`), because Neon Auth rejects the raw
  query (a `+` between scopes trips `INVALID_CALLBACKURL`).
- **DM7 — A grant exists only after the code is exchanged.** Abandoned consents never show as
  connected.
- **DM8 — CIMD documents are fetched only for signed-in users and cached in `oauth_clients`**
  (1 h fresh, 24 h stale-tolerated).
- **DM9 — Write tools check scope in the handler and return a readable tool error.** No step-up
  flow in v1, since scopes are co-granted.
- **DM10 — Tool surface v1:** tasks and projects read/write; routines and history read-only.

## 2. Product requirements

### Goals
- Connect Claude to the app from claude.ai or Claude Code with one URL and one consent.
- Ask Claude about tasks, projects, routines and completion history, and have it create, edit,
  reschedule, complete and delete tasks on explicit request.
- See and revoke connected apps in Settings.

### Non-goals
- A chat UI inside the app. A local stdio server. Routine editing via MCP. Scheduled agent runs
  (AGENT.md §5.3 trigger remains unmet).

### Behaviour
- **Connect.** In claude.ai: Customize → Connectors → Add custom connector →
  `https://guoxuan-todo.vercel.app/api/mcp`, "Sign in now", "Register automatically" (or Claude's
  published identity). In Claude Code:
  `claude mcp add --transport http todo https://guoxuan-todo.vercel.app/api/mcp`, then `/mcp` to
  sign in. Either way Claude sends the browser to the consent page; an unauthenticated user signs
  in with Google or email OTP first and returns to the same consent.
- **Consent page** headlines a fact the server verified, never the client's self-chosen name: for
  CIMD the hostname of the client_id URL, for a self-registered client the words "An unverified app"
  with the redirect host. The name appears as secondary text. Then the signed-in email, the
  requested scopes in plain words, and the redirect host. Approve or Deny.
- **Daily use.** Claude proposes; a write tool call is the user's accept. The Claude client's own
  tool-approval prompt is the one-tap accept (AG3). The web app refetches its lists on tab focus.
- **Settings → Connected apps** lists grants (name, host, scopes, connected, last used) with
  Disconnect. The app's next request fails with 401 and it must go through consent again.
- **Expiry.** A user who does not use the connector for 30 days is asked to sign in again; anyone
  using it at least monthly never is.

### Acceptance
- `tests/e2e/oauth-smoke.ts` passes against localhost and production.
- `tests/e2e/mcp-abuse.ts` (black-box: cross-tenant isolation, token lifecycle, endpoint hardening,
  input abuse, transport) passes against fixtures from `tests/e2e/mcp-fixtures.ts`.
- Claude Code connects via CIMD; claude.ai connects as a custom connector; both list tasks, create
  a task with a deadline, complete it and read routine history.
- Disconnecting in Settings makes the next tool call fail with 401.

## 3. Technical design

### Endpoints

| Path | Role | Auth |
|---|---|---|
| `/.well-known/oauth-protected-resource` (+ `/api/mcp` suffix) | RFC 9728: names `/api/mcp` and the issuer | none |
| `/.well-known/oauth-authorization-server` | RFC 8414: endpoints, S256, `none`, CIMD | none |
| `POST /oauth/register` | RFC 7591 DCR, public clients | none |
| `GET /oauth/authorize` | consent page | Neon Auth session (proxy + page) |
| server actions `approveAuthorization` / `denyAuthorization` | consent decision | `requireUser()` + full re-validation |
| `POST /oauth/token` | code exchange (PKCE) and refresh rotation | none (public client) |
| `GET/POST /api/mcp` | MCP Streamable HTTP, stateless | bearer via `withMcpAuth` |

Code: `src/lib/oauth/*` (config, pkce, redirect-uri, tokens, errors, http, authorize-request,
cimd-document, cimd, metadata, store), `src/lib/mcp/tools.ts`, routes under `src/app/oauth/`,
`src/app/.well-known/` and `src/app/api/mcp/`.

### Schema (`prisma/schema.prisma`)

`oauth_clients` (id = client_id, kind cimd|dcr, redirect_uris, document, fetched_at) →
`oauth_codes` (hashed, PKCE challenge, 10 min, used_at, grant_id) →
`oauth_grants` (user_id, client_id, scope, last_used_at) → `oauth_tokens` (hashed, kind
access|refresh, expires_at, revoked_at). Grants cascade to tokens; clients cascade to both.
No FK to `profiles`, consistent with the rest of the schema.

### Token lifecycle

1. Consent → code (hashed, bound to client, redirect_uri, PKCE challenge, scope, resource).
2. Exchange → code claimed atomically (`updateMany` with `used_at IS NULL`), checks, then grant +
   access (1 h) + refresh (30 d) + the code's `grant_id` in one transaction, so no moment exists in
   which a replay of the code could fail to find what to revoke.
3. Each MCP call → hash lookup, kind/expiry/revocation checks, `last_used_at` touched at most
   every 5 min.
4. Refresh → old refresh marked revoked, new pair issued; expired rows of the grant pruned.
   Presenting a revoked refresh within 3 s is served (racing clients); later it deletes the grant.
   The deletion is committed outside the deciding transaction, so the `invalid_grant` that follows
   cannot roll it back; it is retried three times and logged loudly if it still fails.
5. Code replay after exchange deletes the grant it produced. Disconnect deletes the grant.

### Security checklist

- Authorization code: 10 min, hashed, single-use by conditional update, replay revokes.
- PKCE: S256 only; verifier charset and length validated; constant-time comparison.
- `redirect_uri`: must be pre-registered; exact match, or port-agnostic for loopback
  `localhost` / `127.0.0.1` / `[::1]` (Claude Code); token endpoint re-checks exact equality.
  Errors before the URI is proven registered are rendered on the page, never redirected.
- Tokens: 256-bit random with a type prefix, SHA-256 at rest; `Cache-Control: no-store` on every
  token and registration response; no token or code is ever logged.
- Issuer and `resource` pinned by `APP_URL`; RFC 8707 `resource`, if sent, must equal
  `${APP_URL}/api/mcp` (`invalid_target`).
- Consent: server action + session cookie + Next origin check + full re-validation; the client is
  re-read from the database, never fetched, at decision time; `ensureUserProvisioned` runs here.
- CIMD: https on the default port only; the name must contain a dot and must not be `localhost`,
  `.local`, `.internal`, `.localhost` or `.arpa` (trailing dots stripped first); the name is
  resolved and every address must be public (no loopback, private, link-local, carrier-NAT,
  multicast, ULA, or mapped IPv4); no redirects (pinned by a test against a local 302); 5 s
  timeout; the body is read with a byte counter and abandoned past 64 KB; every failure returns
  the same generic error with the reason logged server-side, so the fetch cannot act as a port
  probe; `client_id` must equal the fetched URL; fetched only after sign-in; cached. A DNS
  rebinding window between resolution and connection remains; the `client_id` echo requirement is
  the second line of defence.
- DCR: public clients only, `content-length` checked before the body is read, body ≤ 8 KB,
  redirect URIs constrained, display names stripped of control, bidirectional and zero-width
  characters. No in-app rate limiter: see the deploy checklist.
- Headers: `frame-ancestors 'none'` and `X-Frame-Options: DENY` on the consent page; HSTS,
  `nosniff` and a strict referrer policy everywhere (`next.config.ts`).
- `redirectTo` is only ever a relative `/oauth/authorize?r=…` built by the proxy or the page, and
  the decoded token is re-validated as a fresh authorization request.
- Per-user scoping: every tool resolves `userId` from the grant behind the verified token.

### Environment

| Var | Where | Value |
|---|---|---|
| `APP_URL` | `.env.local`, Vercel Production | `http://localhost:3001` locally (port 3000 is taken by Docker on the owner's machine); `https://guoxuan-todo.vercel.app` in production |

Preview deployments are unsupported for MCP (no database, pinned issuer); the metadata routes still
render harmlessly.

### Deploy checklist

1. `APP_URL` set in Vercel Production.
2. A Vercel Firewall rate rule on `POST /oauth/register` and `GET /oauth/authorize` (for example
   20 requests per minute per IP). Registration is open by protocol design and the app has no
   in-process limiter; the firewall is the right layer.
3. Next.js at or above 16.3.8 (`npm audit` clean of advisories against `next`).

### Accepted risks

- Within the 3 s reuse grace, a refresh token captured in transit and replayed immediately yields a
  second live chain that is not detected. Token-family linking would close this; the window was
  judged too small to justify it in v1.
- An access token outlives an expired refresh token until its own hour is up.
- Unused self-registered clients are never pruned; the firewall rule bounds their growth.
- Task text is returned to the model verbatim; a connected agent must treat it as data.

### Escape hatch (not built)

If a sign-in method ever drops `redirectTo` entirely, the authorize page can stash the resume
token in an `HttpOnly; SameSite=Lax; Max-Age=600` cookie before redirecting and resume from it on
a bare GET.

## 4. Build phases and verification

| Phase | Contents | Verified by |
|---|---|---|
| 1 | deps, `APP_URL`, schema + migration `add_oauth`, shared validation (`src/lib/validation/*`), pure OAuth helpers, vitest | `npm test` (18 tests), lint, build |
| 2 | proxy matcher + return path, discovery documents, MCP route | `tests/e2e/oauth-smoke.ts` discovery section |
| 3 | store, CIMD resolver, DCR, consent page + actions, token endpoint | `tests/e2e/oauth-smoke.ts` end-to-end |
| 4 | `src/lib/mcp/tools.ts` | Claude Code against localhost |
| 5 | Settings → Connected apps; focus refetch | Disconnect → 401 → reconnect |
| 6 | docs, Vercel `APP_URL`, production smoke, claude.ai connector | prod run of the smoke script; connector connects |

```bash
npx tsx --tsconfig tsconfig.json tests/e2e/oauth-smoke.ts http://localhost:3001
```

The script prints the authorize URL and waits; open it, approve, and it continues through code
exchange, MCP calls, code reuse, refresh rotation and revocation.

### Abuse suite

Written black-box (the author saw only the public endpoints, the specs, and minted fixture
tokens) and kept that way: it is the test that stays honest when the implementation changes.

```bash
npx tsx --tsconfig tsconfig.json --env-file=.env.local tests/e2e/mcp-fixtures.ts <owner email> > /tmp/fixtures.json
npx tsx --tsconfig tsconfig.json tests/e2e/mcp-abuse.ts /tmp/fixtures.json
```

Fixtures provision two extra users and mint valid, expired, and revoked token sets directly into
the store (dev database only). The suite's first run found that grant revocation on refresh
replay was being rolled back by the surrounding transaction, that `2026-02-30` was silently
stored as March 2nd, and that driver errors reached the model verbatim; all three are fixed and
asserted. A later white-box security audit added: a verified headline on the consent page, scope
subsetting, DNS-level SSRF checks and a streaming cap on the CIMD fetch, grant linking inside the
exchange transaction, retried revocation, anchored proxy exclusions, framing headers, a
dev-database guard on the fixtures script, and the Next.js upgrade. See "Accepted risks" above.

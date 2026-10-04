# End-to-end tests

These run against a live server and a database, unlike the unit tests beside the source
(`npm test`). Point them at the dev server (`npm run dev -- -p 3001`, `APP_URL` matching) or at
production. Design and acceptance criteria: [docs/MCP.md](../../docs/MCP.md) §4.

| File | What it does | Needs |
|---|---|---|
| `oauth-smoke.ts` | Acts as an MCP client: discovery, consent, PKCE exchange, tool calls, refresh rotation, code-replay revocation. `--cimd` identifies as Claude Code; `--keep` leaves the grant connected. | a signed-in browser to click Approve |
| `mcp-fixtures.ts` | Provisions two throwaway users and mints valid, expired, and revoked token sets straight into the OAuth tables. Prints JSON. | `.env.local` pointing at the dev branch |
| `mcp-abuse.ts` | Black-box security suite: cross-tenant isolation, token lifecycle, endpoint hardening, input abuse, transport. Exits non-zero on any failure. | the fixtures JSON |
| `app-blackbox.ts` | Black-box behaviour suite for the whole app: the unauthenticated surface of every route, the task model through MCP (field round-trips, defaults, nulls, bulk ops, routines, history windows), protocol consistency, concurrency. Prints `NOTE` for surprising-but-arguable behaviour. | the fixtures JSON |
| `account-delete.ts` | Seeds a throwaway user across the app's tables and Neon Auth's (user, session, linked sign-in), then checks that the export holds every row, that account deletion leaves none, and that a stale session cannot re-provision the deleted user, without touching other users. | `.env.local` pointing at the dev branch |

```bash
npm run test:e2e:smoke -- http://localhost:3001 --cimd
npm run test:e2e:fixtures -- guoxuan.xu8@gmail.com > /tmp/fixtures.json
npm run test:e2e:abuse -- /tmp/fixtures.json
npm run test:e2e:blackbox -- /tmp/fixtures.json
npm run test:e2e:account
```

Run one suite at a time against one server. Regenerating fixtures deletes every token minted
by the previous run, so a suite started before a fixtures run will see its tokens die mid-way.

The fixtures reset their own rows on every run. The abuse suite creates only `[abuse]`-prefixed
data and deletes it; it never touches the owner's other tasks. Never run the fixtures against
production.

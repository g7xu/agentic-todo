# Decisions — agenticTODO

Decisions surfaced by the 10-round review/revise pass over [PRD.md](./PRD.md),
[TDD.md](./TDD.md), [PROMPTS.md](./PROMPTS.md). Last updated: 2026-10-02 (D7 — the agent surface is a
remote MCP server, spec in [MCP.md](./MCP.md)).

Two kinds of entries:
- ✅ **Provisionally resolved** — the docs already chose a default and wrote it in. Listed so you can
  veto. If you're happy, no action.
- **Owner-decided (D1–D7)** — the product trade-offs that were left open are now answered
  (2026-06-28; D6 the backend-stack switch on 2026-06-29; D7 the MCP surface on 2026-10-02) and
  folded into the docs. Recorded below with the chosen option for each.

---

## Resolved (owner-decided 2026-06-28)

### D7 — Agent surface: remote MCP server with an in-app OAuth 2.1 authorization server (decided 2026-10-02)
The agent surface is a **remote MCP server at `/api/mcp`**, not an in-app chat (removed in PR #31)
and not a local stdio server. Full spec in [MCP.md](./MCP.md).
- **Why remote:** one URL works from claude.ai, Claude Desktop and Claude Code; a stdio server would
  need the production database URL on a laptop and cannot be reached from the web or mobile apps.
- **Why an in-app authorization server:** claude.ai custom connectors require OAuth (static bearer
  headers are beta-only), and managed Neon Auth cannot host the Better Auth OAuth-provider plugin.
  Neon Auth proves the human; the app's OAuth layer (CIMD + DCR, PKCE S256, hashed opaque tokens,
  rotated refresh) proves the client and records consent. Swapping identity providers would be the
  expensive migration; five endpoints are not.
- **Scopes and tokens:** `tasks:read` + `tasks:write` granted together; access 1 h, refresh 30 d
  sliding; revoke from Settings → Connected apps.
- **Tool surface v1:** tasks and projects read/write, routines and history read-only. Every tool wraps
  a `src/lib/data` function (AGENT.md AG4).

### D6 — Backend stack: Supabase → Neon + Neon Auth (Better Auth) + Prisma (decided 2026-06-29)
Switched the backend off Supabase to **Neon Postgres + Neon Auth (Better Auth) + Prisma 7**:
- **DB/ORM:** Neon serverless Postgres with **Prisma 7**, **server-only**, run over the
  **`@prisma/adapter-neon`** WebSocket pool (supports interactive transactions); client singleton in
  `src/lib/db.ts`. Two connection strings — `DATABASE_URL` (pooled, runtime adapter) and `DIRECT_URL`
  (unpooled, for `prisma migrate`). Schema in `prisma/schema.prisma`; **Prisma Migrate** for DDL;
  Prisma generates the types (no separate type-gen step).
- **Auth:** **Neon Auth (Better Auth)** — the `@neondatabase/auth` npm package (v0.4.x, **beta**) —
  product methods unchanged (**Google OAuth + email magic link / OTP**). Server helper
  `lib/auth/server.ts` via `createNeonAuth({ baseUrl, cookies: { secret } })`, client helper
  `lib/auth/client.ts` via `createAuthClient()`, a catch-all `app/api/auth/[...all]/route.ts` handler
  (`export const { GET, POST } = auth.handler()`), Next.js 16 middleware in root `proxy.ts`
  (`auth.middleware({ loginUrl: '/auth/sign-in' })`; pre-16 name was `middleware.ts`), and server-side
  `auth.getSession()`. Two env vars: **`NEON_AUTH_BASE_URL`** (the Auth URL from the Neon console → Auth)
  and **`NEON_AUTH_COOKIE_SECRET`** (signs session cookies, ≥ 32 chars, `openssl rand -base64 48`); no
  Stack keys and no service-role key. Better Auth manages its tables in the **`neon_auth`** schema (user
  table `neon_auth.user`); the auth user id is a **uuid** that the app's `Profile.id` stores as an
  app-layer reference (Prisma `String @db.Uuid`, no cross-schema FK).
- **Authorization model (the posture change):** a **two-layer** model. (1) The **enforced v1 boundary
  is app-layer per-user scoping** — Prisma is server-only (no browser/PostgREST data endpoint exists at
  all), and every read/write goes through server actions / a central data layer that always filters by
  and sets `userId` from `auth.getSession()`, never from client input. (2) **Neon RLS** (policies
  using `auth.user_id()` from the Better Auth session JWT — verifiable via the Neon Auth JWKS URL
  `<NEON_AUTH_BASE_URL>/.well-known/jwks.json` — applied via a raw-SQL Prisma migration) is **recommended
  defense-in-depth but vetoable for v1** — wiring per-request JWT binding through Prisma adds real
  complexity, so v1 MAY ship app-layer-only and add Neon RLS as hardening. This is a genuine change
  from Supabase, where RLS was the primary boundary; app-layer scoping is the load-bearing v1 boundary
  either way.
- **Provisioning:** app-layer and idempotent — an `ensureUserProvisioned(userId)` helper **upserts**
  the `Profile` (`timezone = 'UTC'`, `tzCaptured = false`) and a default **Inbox** project on the first
  authenticated request (no DB trigger).
- **Bulk/review atomicity:** all-or-nothing batches run inside **`prisma.$transaction()`** in
  server-only code (replacing the Postgres RPCs), same `{ applied, skipped, tasksChanged }` guarantees.
- **`updated_at`:** via Prisma **`@updatedAt`** on `tasks.updatedAt` (no `BEFORE UPDATE` trigger).

(PRD §1/§2/§3, TDD §1–§4/§6/§7/§8/§9/§10, PROMPTS Phase 0–6 updated; AI SDK major bumped v6→v7.)

### D1 — Can a user fix their timezone after first sign-in? → **(c) editable in Settings**
Timezone is still captured once from the browser on first sign-in (PRD F1, `tz_captured`), but it is no
longer locked: a lightweight **Settings page** exposes an IANA-zone dropdown (defaulting to the captured
value) that **re-writes `profiles.timezone`**, and a tz change invalidates `['tasks']` so date-sensitive
views recompute "today" immediately. `tz_captured` now only gates the one-time browser capture, not the
value. (PRD §3 non-goal removed; PRD F1, TDD §3, PROMPTS Phase 3 updated; v2 entry removed.)

### D2 — How recoverable should a completed task be? → **cross-out + Undo toast + Completed view + uncomplete (full Todoist-style)**
Completion is now **recoverable**: completing shows a brief strikethrough/checked state, removes the task
from active lists, **and** shows a short-lived **Undo toast**. Beyond the toast there is a global
**Completed view** + per-view "show completed" toggle (ordered by `completed_at desc`) and an
**`uncompleteTask`** tool so chat can reopen tasks ("reopen the groceries task"). The chat fan-out guard
stays (now a cost/blast-radius cap, not an irreversibility mitigation). (PRD §3 non-goal removed; new
PRD F8; PRD F2/F6, TDD §6.1/§6.2, PROMPTS Phase 3 & 5 updated; v2 entry removed.)

### D3 — Do tasks scheduled more than 7 days out need a date view? → **(c) extendable board**
The Upcoming board renders the next 7 days initially but is **horizontally scrollable/extendable beyond 7
columns** (lazy-load further day-columns), so future-dated tasks have a date-based home. The board horizon
is a **view affordance only**: chat `'week'` stays the fixed rolling today…+6 window (D5) and the review
`toDate` horizon stays today…+6. (PRD §3 non-goal removed; PRD F5, TDD §5, PROMPTS Phase 4 updated.)

### D4 — What is the per-user daily AI request cap? → **250/day default, owner unlimited**
The default cap is **250 model-invoking requests/user/day** (chat turns + review propose). An
**`OWNER_EMAILS` allowlist** (containing `guoxuan.xu8@gmail.com`) is checked **before** the counter so the
owner bypasses the cap entirely; the cap constant and allowlist live in one place. The cap is still
incremented only immediately before the model call (chat `streamText` / review propose), exempting review
apply and the empty-propose short-circuit. (PRD §7, TDD §7, PROMPTS Phase 5/6 updated.)

### D5 — Does "this week" / Today in chat match the on-screen views? → **recommended defaults accepted**
Confirmed as-is: chat **"this week"** = rolling next 7 days (today…+6) with the reply stating the explicit
date range; chat **"today"** mirrors the Today view (includes overdue); a **"this week"** answer mentions
the overdue count when any exist. These were already in PRD F6 / TDD §6.2 and are left unchanged (the
extendable board in D3 does not affect them — "this week" is a fixed window, the board is a view affordance).

---

## ✅ Provisionally resolved (veto if you disagree)

| # | Decision | Resolved as |
|---|---|---|
| R1 | Timezone source of truth | Stored `profiles.timezone`, captured from browser at first sign-in; single source for all date math |
| R2 | Confirm destructive chat ops | Dedicated **bulk tools** (`bulkReschedule`/`bulkComplete`/`bulkDelete`) with AI SDK approval gate; model must route multi-task changes through them |
| R3 | Multi-task command handling | **Per-operation fan-out guard**: a 2nd distinct task of the *same* op trips approval; heterogeneous 2-action turns auto-execute |
| R4 | Bulk & review apply atomicity | **All-or-nothing** via `prisma.$transaction()` in server-only code (per D6), returns an applied/skipped summary |
| R5 | Subtasks in v1 | **Cut** (`parent_id` deferred to v2) — removed the half-specified feature |
| R6 | Project deletion | Reassign its tasks to **Inbox**, then delete; **Inbox cannot be deleted/un-inboxed** |
| R7 | Chat conversations | **Single persistent thread per user** (no new-chat UI); schema ready for v2 multi-thread |
| R8 | Single-thread growth | Persist full history, send only a **bounded trailing window** to the model (caps cost/latency) |
| R9 | Review trigger | **Button in the chat panel** calling `/api/review` (not a typed NL phrase) — PRD F7 narrowed to match |
| R10 | Today overdue ordering | **Oldest-overdue-first** by due date, then `order, created_at, id` |
| R11 | Quick-add due date | **Contextual defaults** (Today → due today; board column → that day; project/Inbox → no date) so new tasks don't vanish from the view they're added in |
| R12 | Board cross-project reorder | Faithful **within a project**; at equal-`order` cross-project ties the card snaps to the deterministic tiebreaker — **accepted & documented** v1 limit (independent per-view ordering is v2) |
| R13 | Realtime sync | Out for v1; affected views refresh via **cache invalidation** after chat/review mutations |
| R14 | Model id | Pin a concrete Grok id (e.g. `xai/grok-4-fast-non-reasoning`), **verified against the live AI Gateway list at build time**; swappable in one place |

---

## How to use this doc
**All open decisions (D1–D6) are now answered** (D1–D5 owner-decided 2026-06-28; D6 backend-stack
switch 2026-06-29) and folded into PRD/TDD/PROMPTS;
the docs are **final for build** — Phase 0 can start. The ✅ provisionally-resolved rows below stand as
written (veto any you disagree with). If a decision needs to change later, update it here and re-fold the
change across all four docs so every cross-reference stays consistent.

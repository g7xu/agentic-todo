# Build Prompts — Agentic Todoist

Phase-by-phase prompts to execute the build. Feed **one phase at a time**; each ends in something
runnable so you can verify before moving on. Companion docs: [PRD.md](./PRD.md) · [TDD.md](./TDD.md).

**How to use:** paste the "Prompt" block for a phase. The "Done when" checklist is the exit
criteria; don't advance until it passes. Phases are ordered and each assumes the previous is done.

---

## Phase 0 — Scaffold & infra

**Goal:** an empty-but-wired Next.js app with all libraries, a Neon Postgres project, Neon Auth (Better
Auth), and Vercel linked. *(Note: Phase 0 is already scaffolded this way — this prompt describes the built reality.)*

**Prompt:**
> Scaffold a Next.js (App Router, TypeScript) app in this directory with Tailwind and initialize
> shadcn/ui. Install and wire: `@prisma/client`, `@prisma/adapter-neon`, `@neondatabase/serverless`,
> `prisma` (dev), `@neondatabase/auth` (v0.4.x, **beta**), `@tanstack/react-query`, `@dnd-kit/core`, `@dnd-kit/sortable`,
> `ai`, `@ai-sdk/react`, `zod`, `lucide-react`. Set up **Prisma 7** with the new `prisma-client`
> generator (client generated to `src/generated/prisma`, imported as `@/generated/prisma/client`,
> gitignored) and a `postinstall: prisma generate` script. Create a **server-only Prisma client
> singleton in `src/lib/db.ts`** that exports `prisma`, instantiated over the **`@prisma/adapter-neon`**
> WebSocket pool (`PrismaNeon` on `@neondatabase/serverless`, using `DATABASE_URL`). Add
> `prisma/schema.prisma` (empty models for now) and `prisma.config.ts` that loads `.env.local` via
> dotenv. Create a TanStack Query provider in the root layout. Add `.env.local.example` listing
> `DATABASE_URL` (pooled Neon, `-pooler` host), `DIRECT_URL` (unpooled, for `prisma migrate`),
> `NEON_AUTH_BASE_URL` (the Auth URL from the Neon console → Auth), `NEON_AUTH_COOKIE_SECRET`
> (server only, ≥ 32 chars, generate via `openssl rand -base64 48`),
> `AI_GATEWAY_API_KEY`. Do not commit secrets. Create the Neon project (with Neon Auth enabled) and link
> the project to Vercel.

**Done when:** `npm run dev` serves a placeholder page; the Prisma client (`src/lib/db.ts`) and
`@neondatabase/auth` import without error; `prisma generate` runs via `postinstall`; env example present;
Neon project created and Vercel project linked.

---

## Phase 1 — Database schema & migrations

**Goal:** Prisma schema + migrations, app-layer provisioning, optional Neon RLS, generated types.

**Prompt:**
> Author the **Prisma schema** (`prisma/schema.prisma`) for models `Profile`, `Project`, `Task`,
> `Conversation`, `Message` per TDD §3 (incl. `Profile.timezone String @default("UTC")` and
> `Profile.tzCaptured Boolean @default(false)`, with `Profile.id` = the **Neon Auth (Better Auth) user
> id** (a **uuid**) as a `String @id @db.Uuid` that stores `neon_auth.user.id` as an **app-layer
> reference** — **no cross-schema FK** to `neon_auth.user` (Prisma owns only the `public` schema, not the
> Neon-managed `neon_auth` schema); all `userId` columns are likewise `String @db.Uuid`;
> `Message.role` String `user|assistant|system` with
> `content Json` holding UIMessage parts; **`Message.id` is a `String @id` that stores the AI SDK v7
> UIMessage id verbatim — not a uuid, since `generateId()` emits short alphanumeric strings; since those
> ids are globally unique the single-column `@id` alone backs the Phase 5 upsert (conflict target
> `id`) — do **not** add a redundant composite `(conversationId, id)` index, TDD §3/§6.1**). Use
> `Task.updatedAt DateTime @updatedAt` (Prisma maintains it on every update — no trigger), `@@index([userId, dueDate, status])`
> and `@@index([userId, projectId, order])` on `Task`, and `@@unique([userId])` on `Conversation` to
> enforce the v1 one-thread-per-user invariant (so two near-simultaneous first messages cannot create
> two rows; the resolver also reads `findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })` as
> a deterministic fallback — TDD §3). Run **`prisma migrate dev`** to create the tables. In a **raw-SQL
> Prisma migration**, add the **partial unique index** that Prisma can't express in schema —
> `CREATE UNIQUE INDEX ... ON projects (user_id) WHERE is_inbox` — to enforce one Inbox per user; the
> "Inbox cannot be deleted/un-inboxed" rule is an **app-layer guard in the delete/update server action**
> (Phase 3), not a DB trigger. Project deletion reassigns its tasks to the user's Inbox via a
> **`prisma.$transaction()`** in the delete server action (move the project's tasks to Inbox, then
> delete — added with the Phase 3 UI/CRUD; no DB RPC). (Subtasks/`parentId` are out of scope for v1.)
> Provisioning is **app-layer and idempotent**, not a DB trigger: implement an
> **`ensureUserProvisioned(userId)`** helper (server-only) that **upserts** the user's `Profile`
> (`timezone = "UTC"`, `tzCaptured = false`) and a default Inbox `project` (`isInbox = true`) if they
> don't exist, made concurrency-safe by the unique constraints + Prisma `upsert`; it runs on the first
> authenticated request (wired in Phase 2). **Optionally** add **Neon RLS** policies (using
> `auth.user_id()` from the Stack JWT) on every table via a raw-SQL Prisma migration as
> defense-in-depth (TDD §7) — v1 may defer this and ship app-layer-only. Prisma **generates the
> TypeScript types** (to `src/generated/prisma`); there is no separate type-gen step. Apply the
> migrations to the Neon database (`prisma migrate deploy` for Preview/Production).

**Done when:** migrations apply cleanly and `prisma generate` produces compiling types; calling
`ensureUserProvisioned(userId)` (or hitting the first authenticated request) yields a `Profile`
(`timezone = "UTC"`, `tzCaptured = false`) + Inbox project, and calling it again is idempotent (no
duplicates); the partial unique index rejects a second Inbox for the same user; the data layer denies
cross-user access (a query/write with another user's id matches 0 rows) and `userId` is always taken
from the session, never client input; a second `conversations` row for the same user is rejected by the
`@@unique([userId])`; updating a task bumps its `updatedAt` (via `@updatedAt`); generated types compile.
(If Neon RLS shipped: a connection bound to user A's JWT cannot read user B's rows.)

---

## Phase 2 — Auth

**Goal:** working magic link + Google sign-in via Neon Auth (Better Auth), protected routes.

**Prompt:**
> Implement **Neon Auth (Better Auth)** with `@neondatabase/auth` for email magic link / OTP and Google
> OAuth. Create the **server helper `lib/auth/server.ts`**:
> ```ts
> import { createNeonAuth } from '@neondatabase/auth/next/server';
> export const auth = createNeonAuth({
>   baseUrl: process.env.NEON_AUTH_BASE_URL!,
>   cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET! },
> });
> ```
> and the **client helper `lib/auth/client.ts`**:
> ```ts
> 'use client';
> import { createAuthClient } from '@neondatabase/auth/next';
> export const authClient = createAuthClient();
> ```
> Add the catch-all route handler **`app/api/auth/[...all]/route.ts`**:
> `export const { GET, POST } = auth.handler();`. Add the **Next.js 16 middleware file `proxy.ts`** at the
> project root (pre-16 name: `middleware.ts`): `export default auth.middleware({ loginUrl: '/auth/sign-in' });`
> plus an `export const config = { matcher: [...] }` so unauthenticated users on matched routes are
> redirected to `/auth/sign-in`. Add a **`/auth/sign-in` page** that renders Neon Auth's prebuilt React UI
> (`@neondatabase/auth/react/ui`) **or** a custom form calling `authClient.signIn.*` — either is fine.
> Read the authenticated user **on the server** via
> `const { data: session } = await auth.getSession(); const user = session?.user;` in Server Components /
> Route Handlers / Server Actions (mark session-reading Server Components dynamic, e.g.
> `export const dynamic = 'force-dynamic'`); redirect authenticated users landing on the sign-in to
> `/today`. Show the signed-in user's **email** and a **sign-out** action (`authClient.signOut` /
> `auth.signOut`) in the app shell. Configure **Google OAuth + email/magic-link** in the **Neon console →
> Auth** tab: in **dev**, Google OAuth uses Neon's **shared keys** and the **email provider is shared**
> (sender `auth@mail.myneon.app`), so Google sign-in and email magic-link/OTP **work out of the box with
> no Google Cloud or SMTP setup**; **production** needs your own Google OAuth credentials and a verified
> email sender (a Phase 2 / pre-prod step — document the prod setup + redirect URLs). On the **first
> authenticated request**, call **`ensureUserProvisioned(session.user.id)`** (Phase 1) so the `Profile`
> (keyed by the Better Auth user uuid) + Inbox project exist.
> On first sign-in (while `Profile.tzCaptured` is false), capture the browser timezone
> (`Intl.DateTimeFormat().resolvedOptions().timeZone`), persist it to `Profile.timezone` via a **server
> action**, and set `tzCaptured = true` — this is the single source of truth for "today" (TDD §5). A
> genuine UTC user is therefore recorded as `tzCaptured = true` with value `UTC`, distinguishable from an
> uncaptured profile. Immediately after the tz write succeeds, invalidate
> `queryClient.invalidateQueries(['tasks'])` so any first date-sensitive render done against the stale
> `"UTC"` default self-heals to the correct tz without a manual reload (TDD §5 first-render caveat).
> Note the `['tasks']` queries and the `today(tz)` helper / date-sensitive views are not introduced
> until Phase 3, so in Phase 2 this invalidation is a harmless no-op (there is no `['tasks']` cache to
> refetch yet); it only becomes meaningful once Phase 3 exists. Wire the call now so the self-heal is
> in place, but verify its effect in Phase 3 (do not gate Phase 2's "Done when" on it).

**Done when:** magic link and Google both sign a user in and land on `/today`; signing out returns
to the `/auth/sign-in` page; protected routes redirect when logged out (to `/auth/sign-in`); the first authenticated request
provisions the `Profile` + Inbox (`ensureUserProvisioned`); after first sign-in `Profile.tzCaptured` is
true and the persisted timezone matches the browser tz (test by mocking the browser tz to a non-UTC
zone and asserting it is written).

---

## Phase 3 — App shell + Task CRUD + Inbox/Today

**Goal:** the core Todoist UI with working task operations.

**Prompt:**
> Build the app shell: a sidebar with Inbox, Today, Upcoming, a **Completed** entry, and the user's
> projects, plus a **Settings** entry, plus the main
> content area. Add a lightweight **Settings page** (PRD F1): a dropdown of IANA timezones defaulting to
> the current `profiles.timezone` value; changing it **re-writes `profiles.timezone`** via a server
> action and then invalidates `queryClient.invalidateQueries(['tasks'])` so date-sensitive views
> recompute "today" immediately (TDD §3/§5). Implement task CRUD via server actions (create, edit, complete, delete) using the
> **server-only Prisma client, scoped to `auth.getSession()`** (every query filters by / sets
> `userId` from the session, never client input — TDD §4/§7). **Completing is recoverable (Todoist-style, PRD F2/F8):** on
> complete, briefly show a **strikethrough + checked** state, then remove the task from active lists
> (`status='completed'`, set `completed_at`), and show a **short-lived Undo toast** whose action restores
> `status='active'` and clears `completed_at`. Add an **uncomplete** server action (sets `status='active'`,
> clears `completed_at`) and a **Completed surface**: a global **Completed view** listing
> `status='completed'` tasks ordered by `completed_at desc`, plus a per-project/per-view **"show
> completed" toggle** that reveals that view's recently completed tasks inline (also `completed_at desc`);
> from either, the user can **Uncomplete** a task back into the active lists (PRD F8). Add project create/rename/delete UI + CRUD server actions;
> the **delete action runs the reassign-then-delete `prisma.$transaction()`** (move the project's tasks
> to Inbox, then delete — TDD §3), and the Inbox project is not deletable (app-layer guard, TDD §3). When a `projectId` is supplied, verify it belongs to the
> caller (`where: { id: projectId, userId }`) before writing and reject otherwise — app-layer `userId`
> scoping does not by itself constrain `projectId` (TDD §6.2/§7); a task with no project chosen defaults to Inbox. Build the **Inbox** view (tasks in the Inbox project) and
> the **Today** view (incomplete tasks with `due_date <= today`, overdue grouped and flagged). Sort the
> **overdue** group **oldest-overdue-first by due date** (`ORDER BY due_date ASC, "order", created_at, id`,
> the Todoist convention); the **today** group keeps the plain `ORDER BY "order", created_at, id`
> tiebreaker (TDD §5 / PRD F4). Add a
> shared `today(tz)` helper (TDD §5) that computes the user's local date from `profiles.timezone` and
> use it everywhere "today" is needed (Today, board, chat, review) — never the server's UTC clock. Add
> a quick-add input on each view with **contextual `due_date` defaults** (TDD §5 / PRD F2): in a
> project/Inbox view `due_date = null` and the task goes to that project (Inbox when none chosen); in
> **Today**, `due_date = today(tz)` so the new task appears under the today group instead of disappearing
> under the Inbox-null default (board day-column defaults come in Phase 4). The user may override the
> default. Use TanStack Query with
> optimistic updates for complete/edit/delete and rollback on error.

**Done when:** can add/edit/complete/delete tasks; quick-add with no project lands in Inbox; a task
quick-added in Today appears under the today group immediately (due today); Today
shows overdue + today with overdue flagged and the overdue group ordered oldest-overdue-first by due
date; completing a task shows a brief strikethrough/checked state then an Undo toast that restores it;
the Completed view lists completed tasks (newest `completed_at` first) and a per-view "show completed"
toggle reveals them inline; uncompleting (from the toast, the Completed view, or the toggle) returns the
task to its active lists; the Settings page changes `profiles.timezone` and Today/board recompute "today"
without a manual reload; optimistic updates roll back on a forced error.

---

## Phase 4 — Upcoming board (drag & drop)

**Goal:** the extendable day-column board with drag-to-reschedule.

**Prompt:**
> Build the **Upcoming** view as a horizontal day-column board using `@dnd-kit/core` and
> `@dnd-kit/sortable`, starting at Today. **Initially render the next 7 columns (Today … +6 days) but
> make the board horizontally scrollable/extendable beyond 7 columns** — lazy-load further day-columns
> (`t0 + d`, `d > 6`) as the user scrolls the horizon forward (or via a configurable horizon) so
> future-dated tasks have a date-based home on the board, not only their project view (PRD F5 / TDD §5).
> The extendable horizon is a **view affordance only** — do **not** change the chat `'week'` scope or the
> review `toDate` horizon, which both stay the fixed `today(tz)…+6` window (TDD §5/§6.2/§6.3). Each column lists that day's incomplete tasks sorted by `order`. Dragging a
> task to another column updates its `due_date` to that column's date; reordering within a column
> updates `order` using the midpoint rule from TDD §5. Note `order` is a **single project-scoped value
> per task** (not per-column), so a board reorder rewrites the same `order` used by the project view —
> this shared-ordering behavior is intentional in v1 (TDD §5); columns sort by `order` as a stable
> secondary sort with a deterministic tiebreaker **`ORDER BY "order", created_at, id`** so cross-project
> tasks that share an `order` value (e.g. both `1.0`) never render in a flickering order (TDD §5).
> Add a per-column quick-add that defaults `due_date` to that column's date (`t0 + d`) so the new task
> appears in the column it was added in (TDD §5 / PRD F2/F5); the user may override. Persist via a server action with optimistic UI
> and rollback on error. Keep it smooth on touch and mouse. **Known v1 limitation:** because `order` is a
> single project-scoped float, intra-column drop-position fidelity is guaranteed only among **same-project**
> tasks; a card dropped between two equal-order **cross-project** neighbors may snap to the
> `ORDER BY "order", created_at, id` position after refetch (the write still succeeds — not an error) —
> faithful cross-project reorder is a v2 item (TDD §5 / PRD F5). Do not attempt to fix this in v1.

**Done when:** dragging across columns changes due_date and persists after reload; reordering within a
column persists for same-project tasks; cross-project ties resolve to the deterministic tiebreaker
(accepted, not a bug); the board shows the next 7 days initially and **scrolling the horizon forward
reveals further day-columns** with their future-dated tasks; a task quick-added in a day-column appears
in that column (due that column's date); a failed write rolls the card back to its origin.

---

## Phase 5 — Chat assistant

**Goal:** streaming chat that reads and mutates tasks via tools.

**Prompt:**
> Create `/api/chat` using Vercel AI SDK `streamText` with a **pinned** Grok model id (e.g.
> `xai/grok-4-fast-non-reasoning`, verified against the live AI Gateway model list and kept
> swappable) via the Vercel AI Gateway and `stopWhen: stepCountIs(8)`. Resolve the user via
> `auth.getSession()` and use the **server-only Prisma client**, so all tools run scoped to the
> authenticated user (every query filters by / sets `userId` from the session, never client input). Define zod-typed tools per TDD
> §6.2: `listTasks` (every scope **except `'completed'`** excludes `status='completed'`; `'today'` = `active AND due_date <= today(tz)`
> = overdue + today, matching the Today view / F4; `'overdue'` = `active AND due_date < today(tz)`;
> `'week'` = the **fixed** rolling `active AND today(tz)…+6` window (stays today…+6 even though the board
> can scroll past 7 columns); `'inbox'` = active Inbox tasks any
> date; `'all'` = all active tasks; `'completed'` = `status='completed'` tasks ordered by `completed_at desc`,
> backing the Completed view and letting chat resolve a recently completed task to reopen — PRD F8/TDD §6.2), `getTask`,
> `createTask`, `updateTask`, `rescheduleTask`, `completeTask`, **`uncompleteTask` (`{ id }` →
> `status='active'`, clears `completed_at`; auto-executes; "reopen the groceries task", PRD F8)**,
> `deleteTask`, plus **bulk tools**
> `bulkReschedule { ids[], dueDate }`, `bulkComplete { ids[] }`, `bulkDelete { ids[] }`, and
> `listProjects`. Each bulk tool must run its whole set in a **single `prisma.$transaction()` in
> server-only code, scoped to the authenticated user, that is all-or-nothing** (a mid-batch failure
> rolls back the entire batch — no half-applied state; a foreign id fails the `userId` filter and is
> skipped, never written) and return an `{ applied, skipped, tasksChanged }` summary, matching the
> review-apply model; `createTask` assigns `order = max(order within the task's project) + 1` (base
> `1.0` if empty) — the project list is the anchor even when a `dueDate` also places the task in a
> board column, per TDD §5. `createTask`/`updateTask` must **verify the supplied `projectId` belongs to
> the caller** (`where: { id: projectId, userId }`) before writing and reject otherwise — app-layer
> `userId` scoping does not by itself constrain `projectId` (TDD §6.2); a missing `projectId` defaults to Inbox. Gate `deleteTask` and all three bulk tools behind AI SDK tool approval
> (`needsApproval: true`) so they pause for an explicit UI confirm/cancel before executing — do not
> auto-execute them; the single-id `updateTask`/`rescheduleTask`/`completeTask`/`uncompleteTask` auto-execute.
> Add a **model-independent hard guard** (in the tool layer / `prepareStep`) that counts mutating
> single-id tool-calls **per operation** (`updateTask`/`rescheduleTask`/`completeTask`/`deleteTask`
> counted separately) per chat turn and, once the **same operation** is attempted on a **second distinct
> task** in the turn, **blocks auto-execution** and returns a tool result telling the model to re-issue
> *that operation's* changes via the matching approval-gated bulk tool — so "mark everything done" can
> never fan out into multiple auto-executing `completeTask` calls
> regardless of what the model emits (TDD §6.1). The guard must **not** trip on heterogeneous two-action
> turns (one `rescheduleTask` + one `completeTask` on different tasks both auto-execute). Note
> `bulkReschedule` takes a single shared `dueDate`, so multi-date reschedules are issued as one
> `bulkReschedule` per target date (TDD §6.1/§6.2).
> **Before relying on the approval API, verify against the pinned `ai`/`@ai-sdk/react` v7 version**
> that `needsApproval`, `addToolApprovalResponse({ id, approved })`, and the turn pause/resume behavior
> match the current AI SDK v7 HITL docs (names/shapes may have changed); the confirm-before-mutate
> safety guarantee depends on this exact surface (TDD §6.1). Add a
> system prompt that injects today's date via `today(tz)` (from `profiles.timezone`) and the rules
> (never invent task ids — look up first; a **date-only change uses `rescheduleTask`, not
> `updateTask`**; any change affecting more than one task **must use a bulk tool**, never a series of
> single-id calls; destructive/bulk ops require user confirmation via the approval gate; **when the fan-out guard blocks
> an operation — e.g. a same-operation field edit on a 2nd task, which has no bulk path — explicitly
> state which task(s) were applied and which were NOT changed and need a follow-up message, so a
> deferred edit is never reported as done** (TDD §6.2); concise
> replies). Resolve the conversation as **v1 single-thread**: look up the user's one
> `conversations` row and auto-create it on the first message if none exists (leave `title` null — no
> new-chat/switch UX in v1; TDD §3/§6.1). Persist **UIMessages** (roles user/assistant/system, tool
> calls/results as parts) and convert with `convertToModelMessages` on send; **before converting, slice
> the loaded history to a bounded trailing window — the last K whole UIMessages (v1 default K=20, tunable
> in one place), never a partial message — so the model never receives the whole thread as the single v1
> conversation grows; the full list is still persisted and rehydrated for display** (TDD §6.1).
> Persistence must
> **upsert on the conflict target `(id)`** (the globally-unique `text` UIMessage `id`, stored verbatim
> into `messages.id` — it is **not** a uuid, TDD §3), so re-persisting is idempotent and does not
> duplicate rows (TDD §6.1). To keep the wire payload and per-turn DB write bounded (not just the model
> context), have the client send only the **trailing/new message(s)** via the v7 send-request shaping
> hook (`prepareSendMessagesRequest`/`sendExtraMessageFields`-style — **verify the exact v7 API name at
> build time**) and upsert only the **new/changed** message(s) per turn rather than the whole growing
> list (TDD §6.1). Have the endpoint return affected task ids + a
> `tasksChanged` flag. Build a streaming chat panel with `@ai-sdk/react` `useChat` in a right-hand
> drawer that renders the approval confirm UI wired to **`addToolApprovalResponse({ id, approved })`**.
> The approval card must **show which tasks are affected — title(s) and count** (e.g. "Delete 3 tasks: …")
> — before the user approves, so the confirm is informed. The **count** comes from the tool-call args,
> but the args carry only **ids** (`{id}`/`{ids[]}`, not titles — only `createTask` args contain
> `content`), so resolve each id to a title from the **TanStack Query `['tasks']` cache**; for any
> affected id not in the cache, fall back to the id with a **"(not in current view)"** label (TDD §6.1).
> Invalidate `queryClient.invalidateQueries(['tasks'])` in `onFinish` **and** on approval resolution
> and after the resumed turn settles — because the open v7 issue (vercel/ai #10169) means `onFinish`
> may not fire on approval-paused turns, so refresh must not depend on it alone.
> **Enforce a minimal per-user daily request cap** in `/api/chat` — increment/check it **immediately
> before calling `streamText`** (not as an unconditional top-of-handler gate; the cap is scoped to the
> model call, TDD §7) using an atomic per-user, per-UTC-day counter keyed by the **Neon Auth (Better Auth) user id** (uuid)
> (`(await auth.getSession()).data?.user.id`) — a Neon Postgres `(user_id, day, count)` upsert or KV token bucket.
> The **default cap is 250 model-invoking
> requests/user/day**, and an **`OWNER_EMAILS` allowlist** (containing `guoxuan.xu8@gmail.com`) is checked
> **before** the counter so the owner **bypasses the cap entirely** (counter neither checked nor
> incremented); keep the cap constant and the allowlist in **one place** (TDD §7). Over the limit return
> **HTTP 429** without invoking Grok, since every call bills the owner's shared `AI_GATEWAY_API_KEY`
> (TDD §7). **Handle chat error
> states explicitly** (do not defer entirely to Phase 7): wire `useChat` `onError` and render a visible
> failure state for a failed/aborted stream, an AI Gateway 4xx/5xx (incl. the 429 rate-limit response),
> and a model/tool error, with a retry affordance — the LLM is an external dependency with non-trivial
> failure modes.

**Done when:** "what's due this week?" returns the correct tasks (rolling 7-day range, consistent with
the board); "what's due today?" returns overdue + today (same set as the Today view / F4), excluding
completed tasks; "add buy milk to inbox" creates the task; "reopen the <task> task" uncompletes a completed task (via
`uncompleteTask`, found through the `'completed'` scope) and it reappears in active lists; "move <task> to Friday" reschedules it (via
`rescheduleTask`) and the board reflects it without a manual reload (cache invalidated); "delete
<task>" does **not** delete until the user confirms in the approval UI; the approval card shows the
affected task title(s)/count before the confirm; a multi-task command ("move
all overdue to next week" / "mark everything done") routes through a bulk tool and is **not** applied
until confirmed; even if the model emits single-id calls, the hard guard blocks a **second same-operation**
auto-executing single-id mutation in a turn and redirects to the bulk/approval path, while a
heterogeneous two-action turn ("move dentist to Friday and mark groceries done") auto-executes both
without an approval prompt; a blocked second same-operation field edit ("set both A and B to p1")
applies the first task and the reply **names the un-applied task(s)** as needing a follow-up (not
silently dropped); chat history persists to the
user's single auto-created conversation and rehydrates
correctly, only a bounded trailing window is sent to the model, only the trailing/new message(s) are
sent on the wire and upserted per turn (no duplicate rows, no whole-list re-write); a failed/aborted
stream or Gateway 4xx/5xx surfaces a visible chat error state (not a silent hang), and exceeding the
per-user daily cap returns 429 and is shown as an error without calling the model.

---

## Phase 6 — Review skill (agentic flow)

**Goal:** the end-of-day review state machine with confirm-before-apply.

**Prompt:**
> Implement the end-of-day review as an explicit server-side flow with a `mode` discriminator on one
> route. Add `/api/review`: **`mode:'propose'`** — (1) the server deterministically gathers incomplete
> tasks (overdue + today, not done) using `today(tz)` from `profiles.timezone` — the model does not
> decide what's incomplete; **if the gathered set is empty, short-circuit and return a "nothing to
> review" result (`{ plan: [], empty: true }`) without calling `generateObject`**; (2) call
> `generateObject` with a zod schema to produce a reschedule plan
> `[{ taskId, fromDate, toDate, reason }]`, validating with `schema.parse` and retrying once on a
> conformance failure; (3) return the plan to the client and render it as a confirmable, editable list
> with no DB writes yet. Because review is a dedicated endpoint and **not** a `useChat` tool, render the
> plan in a **dedicated review component mounted inside the chat panel** with its own state — do **not**
> inject it into the `useChat` message stream — and wire the apply-step cache invalidation
> (`queryClient.invalidateQueries(['tasks'])`) from **that component's apply handler**, not from
> `useChat` `onFinish` (TDD §6.3). **`mode:'apply'`** with the (possibly edited)
> `items: [{ taskId, fromDate, toDate }]` — the client echoes back each item's propose-time `fromDate`
> (the plan is not persisted server-side, so the apply transaction needs it to detect moves) — (4) apply all
> reschedules in a **single `prisma.$transaction()` in server-only code, scoped to
> `auth.getSession()`** (every statement filters by `userId`, so a task id from another user
> fails to match and is rejected/skipped, never written — `userId` must come from the session, never
> the request body), re-validating each item against current state and **skipping** tasks already completed/deleted/moved
> (where current `due_date` no longer matches the supplied `fromDate`) and any item whose
> `toDate < today(tz)` — re-derive `today(tz)` at apply time so a midnight rollover between propose and
> apply is safely skipped as `past_date` (not errored); surface `past_date` skips prominently in the
> summary so the user can re-run review (TDD §6.3); return
> `{ applied, skipped, tasksChanged }` and have the client render the summary and invalidate the
> `['tasks']` cache. Let the user edit individual moves before confirming. Add a **"Review my day"
> button** in the chat panel that calls `/api/review` (PRD F7). The review is a dedicated endpoint, not
> a chat tool, so in v1 it is launched by this button — not by typing a phrase into the chat (the chat
> model has no review tool to invoke). **Enforce the same minimal per-user daily request cap** on
> `/api/review` **only in `mode:'propose'`, immediately before `generateObject` and after the empty
> short-circuit** (the **same shared counter, 250/day default, and `OWNER_EMAILS` allowlist** as
> `/api/chat`, TDD §7); over the limit return 429 without invoking
> the model. **Do not** count `mode:'apply'` (a pure DB transaction, no model call) or the empty
> "nothing to review" return against the cap — so a user who already proposed a plan can always apply it
> even when over quota, and an empty propose never consumes quota (TDD §7). **Constrain the propose schema/prompt to `toDate` within the
> next 7 days** (`today(tz)…today(tz)+6`, the board-visible horizon) so a proposed move is never placed
> beyond the board (where it would be invisible on the board and absent from Today); if a `toDate` still
> lands beyond the horizon, **note it in the apply summary** (TDD §6.3). **Handle review error states
> explicitly** (do not defer to Phase 7): a `generateObject` schema/parse failure after the one retry,
> and a Gateway/rate-limit (429) or stream failure, surface a graceful error in the review component with
> a retry affordance rather than a silent failure or a malformed plan.

**Done when:** triggering review shows a proposed plan with reasons (proposed dates fall within the next
7 days); with zero incomplete tasks it
returns "nothing to review" without calling the model; nothing moves before confirm; confirming
applies all moves in one transaction and shows a per-item summary (applied + skipped), with items
changed since propose skipped (not errored); edited moves apply as edited; a `generateObject` failure
(after retry) or a Gateway/429 error surfaces a graceful error state, not a silent failure; Today/board
refresh after apply.

---

## Phase 7 — Polish, observability, deploy

**Goal:** production-ready and traceable.

**Prompt:**
> Enable AI SDK telemetry through the Vercel AI Gateway so chat and review runs appear as traces. Add
> loading, empty, and error states across views; add keyboard quick-add. **Note:** the core list views
> (Today, Inbox, board day-columns) were built in Phases 3–4 without dedicated empty states, so the
> empty states added here are **retro-applied** and must be **smoke-tested against those earlier views**
> (render an empty Today, empty Inbox, and an empty board column) to catch any empty-state regression
> that could have slipped through Phases 3–6. Verify env vars in Preview
> and Production with `vercel env`, deploy to Vercel, and run a production smoke test: auth → add task
> → board drag → chat command → review confirm. Note that Vercel Hobby is non-commercial — flag if a
> Pro upgrade is needed before charging users.

**Done when:** chat + review steps show in the AI Gateway dashboard; production URL passes the full
smoke test; an empty Today, empty Inbox, and empty board column each render their empty state (not a
blank/broken view); no missing env vars in any environment.

---

## Cross-cutting checks (run after each phase)
- `npm run build` and `npm run lint` pass.
- New tables/queries respect per-user scoping (cross-user access denied at the data layer; Neon RLS if enabled).
- No secrets committed; all keys via env.
- Tests from TDD §8 added for the code introduced in that phase.

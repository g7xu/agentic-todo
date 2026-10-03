# TDD — agenticTODO (Technical Design Document)

**Owner:** Jason
**Status:** Draft v1
**Last updated:** 2026-06-28
**Companion docs:** [PRD.md](./PRD.md) · [PROMPTS.md](./PROMPTS.md)

---

## 1. Architecture overview

```
Browser
  Next.js App Router · React · Tailwind + shadcn/ui · dnd-kit · TanStack Query
        │  server actions / route handlers
        ▼
Next.js server (Vercel Fluid Compute)
        ├── Neon Auth (Better Auth) · auth.getSession()  ──► @neondatabase/auth + neon_auth.user
        ├── Prisma (server-only, @prisma/adapter-neon) ──► Neon Postgres   [per-user app-layer scoping]
        └── /api/chat, /api/review  (Vercel AI SDK)
                  └── Vercel AI Gateway ──► Grok (xai/grok-*)   [+ trace dashboard]
```

Why this stack: Vercel AI SDK runs natively on Fluid Compute (low cold-start), gives streaming +
tool-calling + a controllable multi-step loop, and routes to Grok through the AI Gateway for a
free/cheap model with LangSmith-style trace observability — without a separate graph runtime.

## 2. Tech stack & libraries

| Concern | Choice |
|---|---|
| Framework / host | Next.js (App Router, TypeScript) on Vercel |
| DB + ORM | **Neon Postgres** (serverless) via **Prisma 7** (`@prisma/client`), server-only, over the `@prisma/adapter-neon` WebSocket pool (`@neondatabase/serverless`) |
| Auth | **Neon Auth (Better Auth)** (`@neondatabase/auth`, v0.4.x **beta**) |
| Auth methods | Email magic link / OTP + Google OAuth |
| UI | Tailwind CSS, shadcn/ui, lucide-react |
| Server state / optimistic | @tanstack/react-query |
| Drag & drop | @dnd-kit/core + @dnd-kit/sortable |
| Auth client/server | `@neondatabase/auth` — server `lib/auth/server.ts` via `createNeonAuth({ baseUrl, cookies: { secret } })` (exposes `.handler()`, `.middleware()`, `.getSession()`, `.signIn`, `.signOut`); client `lib/auth/client.ts` via `createAuthClient()`; route handler `app/api/auth/[...all]/route.ts`; Next.js 16 middleware in root `proxy.ts` (`auth.middleware({ loginUrl })`) |
| AI | `ai` (Vercel AI SDK v7), `@ai-sdk/react` (`useChat`) |
| Model | Grok via AI Gateway, **pinned to a concrete id** (e.g. `xai/grok-4-fast-non-reasoning` — cheaper/faster for tool-calling; a `xai/grok-4.1-fast-*` variant is also valid). The exact id **must be verified against the live AI Gateway model list at build time** (ids change; reasoning vs non-reasoning variants differ in latency/cost and structured-output behavior). Swappable in one place. `xai/grok-*` elsewhere in this doc is shorthand for the chosen id, not a literal wildcard. The review flow depends on `generateObject` (structured output) through Grok, so schema conformance is validated (`zod.parse` + one retry) and not assumed reliable. |
| Validation | zod (shared between tools and forms) |

## 3. Data model (Neon Postgres, via Prisma)

The schema lives in `prisma/schema.prisma` (Prisma models `Profile`, `Project`, `Task`,
`Conversation`, `Message`) and is created/evolved with **Prisma Migrate**. All user tables carry
`user_id` and isolation is a **two-layer model** (§7): the **enforced v1 boundary is app-layer
per-user scoping** — Prisma is **server-only** (no browser/PostgREST data endpoint exists), and every
read/write goes through a server action / central data-access layer that **always filters by and sets
`userId` from `auth.getSession()`**, never from client input, so a forged/foreign id simply
fails to match `where: { id, userId }` (0 rows) rather than crossing users. **Neon RLS** policies (on
`auth.user_id()`, applied via a raw-SQL Prisma migration) are **recommended defense-in-depth but
optional for v1** (§7). Because the `createTask` path always derives `userId` from the session, the
app-layer scoping is the load-bearing equivalent of the old `WITH CHECK` guarantee.

### Profile (`profiles`)
| field (column) | type | notes |
|---|---|---|
| id (`id`) | String `@id @db.Uuid` | the **Neon Auth (Better Auth) user id** — a **uuid** — storing `neon_auth.user.id` as an app-layer reference (no cross-schema FK; Prisma owns only `public`, not the Neon-managed `neon_auth` schema) |
| email (`email`) | String | |
| timezone (`timezone`) | String | IANA tz (e.g. `America/Los_Angeles`); set on first sign-in from the browser; default `"UTC"` |
| tzCaptured (`tz_captured`) | Boolean | default false; set true once the browser tz has been written, so "captured" is verifiable independent of whether the value happens to equal `UTC` (a genuine UTC user is `tzCaptured = true`, value `UTC`) |
| createdAt (`created_at`) | DateTime | `@default(now())` |

`timezone` is the **single source of truth** for computing "today" everywhere (Today view, board
columns, chat system prompt, review gather). It is captured client-side via
`Intl.DateTimeFormat().resolvedOptions().timeZone` on first sign-in and written to the profile
(setting `tz_captured = true`) while `tz_captured` is still false; see §5 for the shared `today(tz)`
helper. After capture, the user can **change it later** in a Settings page (PRD F1): an IANA-zone
dropdown defaulting to the current `profiles.timezone` re-writes the column on change. Because this
is editable post-capture, the `tz_captured` flag only gates the one-time first-sign-in browser capture
(it does not lock the value). After a Settings tz change, the client invalidates
`queryClient.invalidateQueries(['tasks'])` so date-sensitive views recompute "today" immediately
(same self-heal as the first-render caveat in §5).

### Project (`projects`)
| field (column) | type | notes |
|---|---|---|
| id (`id`) | String `@id` | cuid/uuid default |
| userId (`user_id`) | String `@db.Uuid` | the Neon Auth (Better Auth) user id (**uuid**), storing `neon_auth.user.id` as an app-layer reference (no cross-schema FK) |
| name (`name`) | String | |
| color (`color`) | String? | nullable |
| isInbox (`is_inbox`) | Boolean | default false; exactly one true per user (enforced, see below) |
| order (`order`) | Float | sidebar ordering |
| createdAt (`created_at`) | DateTime | |

**Inbox integrity:** enforce one Inbox per user with a **partial unique index**. Prisma can't express
a partial unique index in `schema.prisma`, so it is added via **raw SQL inside a Prisma migration**:
`CREATE UNIQUE INDEX ON projects (user_id) WHERE is_inbox;`. The Inbox project may not be deleted or
un-inboxed (F3 depends on it) — enforced by an **app-layer guard in the delete/update server action**
(no DB trigger) that rejects deleting/clearing `isInbox` on the Inbox row.

**Deletion semantics:**
- `tasks.projectId` → `projects.id`: deleting a non-Inbox project **reassigns its tasks to the
  user's Inbox** (a DB `ON DELETE` rule is insufficient, so this is done in the delete server action as
  a single **`prisma.$transaction()`**: move the project's tasks to the user's Inbox, then delete the
  project — all-or-nothing).
- (Subtasks/`parentId` are out of scope for v1 — see §10.)

### Task (`tasks`)
| field (column) | type | notes |
|---|---|---|
| id (`id`) | String `@id` | cuid/uuid default |
| userId (`user_id`) | String `@db.Uuid` | the Neon Auth (Better Auth) user id (**uuid**), storing `neon_auth.user.id` as an app-layer reference (no cross-schema FK) |
| projectId (`project_id`) | String | FK → `projects` |
| content (`content`) | String | title |
| description (`description`) | String? | |
| priority (`priority`) | Int | 1–4 (1 = p1 highest, 4 = default) |
| dueDate (`due_date`) | DateTime? `@db.Date` | |
| status (`status`) | String | 'active' \| 'completed' |
| order (`order`) | Float | cheap reordering; **project-scoped & authoritative in the project view**, used as a stable secondary sort by the cross-project Today/board lists (see §5) |
| completedAt (`completed_at`) | DateTime? | |
| createdAt (`created_at`) | DateTime | `@default(now())` |
| updatedAt (`updated_at`) | DateTime | **`@updatedAt`** — Prisma maintains it on every update (see below) |

### Conversation (`conversations`)
| field (column) | type | notes |
|---|---|---|
| id (`id`) | String `@id` | cuid/uuid default |
| userId (`user_id`) | String `@db.Uuid` | the Neon Auth (Better Auth) user id (**uuid**); `@@unique([userId])` (one thread per user, see below) |
| title (`title`) | String? | **unused in v1** (single-thread model, see §6.1) — reserved for v2 multi-conversation |
| createdAt (`created_at`) | DateTime | |

**Conversation lifecycle (v1 = single thread per user).** v1 is **single-conversation per user**:
exactly one `conversations` row, **auto-created on the user's first chat message** if none exists, and
reused for every subsequent message. There is no new-chat / switch / list UX and no title editing in
v1 (`title` is left null). Multi-conversation (list/switch/new + derived titles) is a v2 candidate.

**One-row invariant (enforced).** The "user's one `conversations` row" is enforced by a plain unique
on `userId` (Prisma **`@@unique([userId])`**) so two near-simultaneous first messages cannot insert two
rows (the second loses the race and the create is retried as a lookup, or the create is a Prisma
`upsert` keyed on `userId`). The lookup is additionally made deterministic — Prisma
`findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })` for the session user — as a fallback so
resolution is unambiguous even if a stray second row ever exists.

### Message (`messages`)
| field (column) | type | notes |
|---|---|---|
| id (`id`) | String `@id` | the AI SDK v7 **UIMessage `id`** (from `generateId()` — a short alphanumeric string, **not** a uuid), stored verbatim so it can serve as the upsert key |
| conversationId (`conversation_id`) | String | FK → `conversations` |
| userId (`user_id`) | String `@db.Uuid` | the Neon Auth (Better Auth) user id (**uuid**) |
| role (`role`) | String | 'user' \| 'assistant' \| 'system' (AI SDK **UIMessage** roles) |
| content (`content`) | Json | full UIMessage `parts` array (text + tool-call/tool-result parts) |
| createdAt (`created_at`) | DateTime | |

**Message id is a `String`/`text`, not a `uuid`.** AI SDK v7 UIMessage ids come from `generateId()` and are short
alphanumeric strings, **not** UUIDs, so the persisted `id` is a `text` column (upserting such ids into
a `uuid` column would fail at runtime). Because `generateId()` ids are globally unique, the **`text`
PK on `id` alone guarantees uniqueness**, and the upsert conflict target is **`(id)`** (§6.1) — there
is no separate composite `(conversation_id, id)` index (it would be redundant given the global PK).
(Alternatively the `useChat`/`generateId` id generator could be configured to emit UUIDs; v1 chooses
the simpler `text` id to avoid coupling persistence to a custom id generator.)
**Cross-user id-collision behavior (accepted).** The "globally unique" assumption is load-bearing for the
PK-as-conflict-target design, but it is safe even in the astronomically unlikely event two users'
`generateId()` ids collide: the persistence upsert is performed by the **server-only data layer scoped to
the session user**, so user B's write carries `userId = B`. A colliding id whose existing row belongs to
user A would be updated only if it matched the user-scoped predicate (`id` **and** `userId = B`), which it
does not — so it surfaces as 0 rows / a spurious persistence failure for that one message, never a silent
overwrite of another user's row. This residual behavior is accepted in v1; making the conflict target
composite on `(userId, id)` would also work but contradicts the "no redundant composite index" rationale
above, so v1 keeps the single-column PK and relies on **app-layer per-user scoping** (§7) as the
cross-user backstop.

**Message persistence model:** we persist **UIMessages** (not ModelMessages), so the role enum is
`user | assistant | system` and tool calls/results are stored as **parts inside an assistant
message** — there is no top-level `'tool'` role. On send, history is loaded and converted with
`convertToModelMessages(...)` before being passed to `streamText`; `useChat` rehydrates directly from
the stored UIMessages. This avoids round-trip/rehydration mismatches with AI SDK v7. See §6.1.

**`tasks.updatedAt` maintenance.** `updatedAt` is kept current by Prisma's **`@updatedAt`** attribute on
the field: Prisma sets it on every row update (edits, reschedules, completes, reorders) — including the
bulk/review writes, which go through Prisma (§6.2/§6.3) — so it never goes stale and does not depend on
each mutating server action remembering to set it. No `BEFORE UPDATE` trigger is needed.

**Indexes:** `@@index([userId, dueDate, status])`, `@@index([userId, projectId, order])` on `Task`.

**New-user provisioning (app-layer, idempotent).** Neon Auth (Better Auth) doesn't expose a
user-creation trigger into your `public` schema, so there is **no DB trigger**. Instead provisioning runs in app code on the **first
authenticated request**: an `ensureUserProvisioned(userId)` helper **upserts** the user's `Profile`
(`timezone = 'UTC'`, `tzCaptured = false`) and a default Inbox `project` (`isInbox = true`) if they do
not already exist. It is **concurrency-safe** via the unique constraints (Profile `id`, the partial
Inbox index) + Prisma `upsert` (`ON CONFLICT DO NOTHING` semantics), so two near-simultaneous first
requests cannot create duplicates. The profile is created with `timezone = 'UTC'` and corrected on
first sign-in (see Profile above).

## 4. Access patterns

- All reads/writes go through **server actions / a central data-access layer** using the **server-only
  Prisma client** (`src/lib/db.ts`, over the `@prisma/adapter-neon` pool), always scoped to the
  authenticated user obtained from `auth.getSession()` — the layer always filters by and sets
  `userId` from the session, never from client input (§3/§7). There is no browser data endpoint, so the
  server-side secrets (`DATABASE_URL`/`DIRECT_URL`, `NEON_AUTH_COOKIE_SECRET`) are never reachable on the
  client; there is no service-role-equivalent key.
- The client uses **TanStack Query** for caching + optimistic updates (critical for drag & drop).
- The `order` column is `float8`: inserting between two items uses the midpoint of neighbors.
  **Rebalance trigger:** when a midpoint insert would leave any adjacent gap `< epsilon`
  (e.g. `1e-6`), renormalize to evenly spaced integer-ish values (`1.0, 2.0, …`) in a single update
  before applying the move, avoiding float precision exhaustion. **Renormalization is always
  project-scoped**, never column-scoped: even when the move originates from a cross-project board
  day-column (F5), it renormalizes the **affected task's project `order` set** (the
  `tasks(user_id, project_id, "order")` list), **not** the cross-project board column. Column-scoped
  renormalization would rewrite `order` across several projects' tasks at once and scramble each of
  those project views far beyond the accepted "shared ordering" side effect of a single reorder (§5).
  Covered by a unit test (§8).
- **Cross-surface refresh after chat/review mutations (no real-time).** Chat/review tools mutate the
  DB server-side, so the client's TanStack Query caches (Today, board, project views) would go stale.
  Each mutating endpoint returns the set of affected task ids plus a `tasksChanged: true` flag in its
  response; the client calls `queryClient.invalidateQueries(['tasks'])` from the `useChat`
  `onFinish` handler (and from the review apply handler) to re-fetch. This replaces push-based
  real-time, which is a stated non-goal.
  - **Approval-pause caveat (AI SDK v7).** `onFinish` may not fire on turns that pause for tool
    approval (see the open issue noted in §6.1). To guarantee refresh regardless of the pause, also
    invalidate `['tasks']` (a) when an approval is resolved (in the approval-response handler) and
    (b) after the resumed turn settles — so cross-surface refresh never depends solely on `onFinish`.

## 5. Ordering & date-bucketing logic

- **Single "today" source.** All "today"/date math uses one shared helper, `today(tz)`, that returns
  the user's current local calendar date (a `YYYY-MM-DD` string) computed from `profiles.timezone`
  (not the server's UTC clock — Vercel functions run in UTC, which would be wrong near midnight for
  non-UTC users). This same helper feeds the Today view, board column dates, the chat system prompt's
  injected date, and the review gather step, so they can never disagree about what day it is. Since
  `due_date` is a plain `date`, comparisons are date-string comparisons in the user's tz.
  - **First-render tz caveat (one-time self-heal).** On the very first landing on `/today`, the
    profile may still read the provisioned default `timezone = 'UTC'` (set by `ensureUserProvisioned`,
    §3) because the browser tz write (F1 /
    Phase 2) has not completed yet, so a non-UTC user can briefly see the wrong day's Today/board
    bucketing. We accept a one-time correction-on-capture: immediately after the tz write succeeds
    (`tz_captured = true`), invalidate `queryClient.invalidateQueries(['tasks'])` so date-sensitive
    views re-fetch under the correct tz and self-heal without a manual reload.
- **`order` scope (single value, authoritative in project view).** Each task has exactly one `order`
  float. It is **project-scoped and authoritative in the project view** (the index is
  `tasks(user_id, project_id, "order")`). The **Today list** (overdue + today, cross-project) and each
  **board day-column** (all tasks due that day, cross-project) are cross-project surfaces that display
  by `order` only as a **stable secondary sort** within their grouping — `order` is not independently
  scoped per board column. Because `order` is project-scoped and renormalized per-list to integer-ish
  values on rebalance (§4), two tasks from different projects frequently share the same `order` (e.g.
  both `1.0`) in a cross-project grouping, so an explicit deterministic tiebreaker is required:
  cross-project lists (Today and each board day-column) sort **`ORDER BY "order", created_at, id`** so
  ties never render in a nondeterministic / flickering order.
  - **Overdue group exception (Today).** The Today view's **overdue** group (PRD F4) sorts
    **`ORDER BY due_date ASC, "order", created_at, id`** — oldest-overdue-first by date (Todoist
    convention), then the same `order`/`created_at`/`id` tiebreaker. The **today** group keeps the plain
    `ORDER BY "order", created_at, id` (every item shares the same `due_date`, so a date sort is moot).
    Board day-columns also keep the plain tiebreaker (a column is a single day). Covered by a unit test
    (§8).
  Consequence: reordering within a board day-column (F5) rewrites the same
  `order` that drives the project view (and Today), so a board reorder can reshuffle the project view
  and vice-versa. This **shared-ordering behavior is intentional and accepted in v1**; independent
  per-context ordering is a v2 candidate. A unit test asserts this cross-view behavior (a board reorder
  updates the task's single `order` and the project view reflects the same relative order — §8).
- **Reorder within list:** new `order = (prev.order + next.order) / 2`; at the ends, `±1`. This
  midpoint math assumes the rendered neighbors have **distinct** `order` values. In a project view that
  always holds (the renormalized project set has distinct integer-ish values). In a **cross-project
  board day-column (or Today)** it does **not**: several tasks from different projects routinely share
  the same `order` (e.g. multiple `1.0`s), so a drop between two equal-order cross-project neighbors has
  a midpoint equal to both, the rebalance renormalizes only the **dragged task's own project** set (§4,
  never the column), and the task's final column slot is decided by the `created_at`/`id` tiebreaker —
  not the drop position.
  - **Accepted v1 limitation (cross-project reorder is not position-faithful at ties).** A single
    project-scoped `order` float cannot represent a stable arbitrary cross-project ordering, so board
    intra-column reorder is **non-deterministic at tie boundaries**: it is guaranteed faithful only among
    **same-project** tasks in the column. A card dropped between equal-order cross-project neighbors may
    visibly **snap** to the `ORDER BY "order", created_at, id` position after refetch even though the
    write succeeded (not an error — rollback does not apply, PRD F5). Making cross-project drop-position
    faithful (e.g. a per-column computed sort key derived from the adjacent *rendered* neighbors'
    effective keys) is deferred to v2 alongside independent per-view ordering (§10). A unit test asserts
    the deterministic tie behavior so the snap is at least predictable (§8).
- **New-task ordering (quick-add / `createTask`):** a brand-new task is appended **relative to its
  project list** — `order = max(order within that project) + 1` — and the first task in an empty
  project gets a base value (`1.0`). Because there is exactly one shared `order` value, this is the
  single anchor for quick-add (whether issued from a project view, a board day-column, or chat
  `createTask`); the new task's position within a board day-column then follows from that shared value
  plus the cross-project tiebreaker above (`ORDER BY "order", created_at, id`), so a freshly created
  task sorts last within its column among equal `order` values via `created_at`. This is the default
  for quick-add and the `createTask` tool (§6.2).
- **Contextual quick-add `due_date` (so the task lands in the view it was added in).** Quick-add derives
  a default `due_date` from the view it is invoked in (Todoist convention, PRD F2): **project / Inbox
  view → `due_date = null`** (assigned to that project); **Today view → `due_date = today(tz)`** (so it
  satisfies Today's `due_date <= today(tz)` filter and does not vanish); **board day-column → `due_date =`
  that column's date** (`t0 + d`). The user may override in the input. Only the *default* differs by view;
  `order` is anchored to the task's project list regardless (above). Chat `createTask` is **not** view-scoped
  and uses an explicit `dueDate` arg (null when omitted), so this contextual default applies to the UI
  quick-add path, not the tool.
- **Board columns:** with `t0 = today(tz)`, column `d` (`d >= 0`) maps to `t0 + d days`. A task belongs
  to column `d` if `status = 'active'` **and** `due_date == t0 + d` (the `status = 'active'` filter is
  required so completed tasks never surface on the board — matches PRD F5 / Phase 4). Tasks with
  `due_date < t0` surface in Today (overdue), not the board. The board **initially renders `d = 0..6`
  (the next 7 days)** but is **extendable beyond +6**: scrolling the horizon forward lazy-loads further
  day-columns (`d > 6`), so future-dated tasks have a date-based home on the board (PRD F5). The
  extendable board is purely a **view affordance** and does **not** change the chat `'week'` scope, which
  stays the fixed `today(tz)…today(tz)+6` window (§6.2), nor the review `toDate` horizon, which stays
  `today(tz)…+6` (§6.3).
- **Drag across columns:** set `due_date` to the target column's date and recompute `order`
  relative to drop position.

## 6. Agent design

### 6.1 Chat endpoint `/api/chat`
- Resolves the authenticated user via **`auth.getSession()`** and uses the **server-only Prisma
  client** → every tool runs scoped to that user (the data layer always filters by / sets `userId` from
  the session, §4/§7).
- Model: a **concrete, pinned** Grok id via the Gateway (e.g. `xai/grok-4-fast-non-reasoning`,
  verified against the live AI Gateway model list at build time), kept swappable in one place
  (§2/§9). The `xai/grok-*` form in this doc denotes "the chosen Grok model", not a literal
  wildcard passed to the SDK.
- **Resolves the conversation (v1 single-thread):** looks up the user's one `conversations` row and
  **auto-creates it on the first message** if absent (§3 conversation lifecycle); `title` is left null
  in v1. **`conversation_id` is always resolved server-side and never accepted from the client**, so the
  `projectId`-style ownership check (§6.2) is unnecessary for `messages` in v1 — the same gap
  (app-layer `userId` scoping constrains only `userId`, not the `conversationId` FK) cannot be reached
  because the client never supplies it. Loads prior **UIMessages** for that conversation, appends the new user message, and calls
  `streamText({ model, system, messages: convertToModelMessages(uiMessages), tools, stopWhen: stepCountIs(8) })`.
  On finish, the full updated UIMessage list (with tool parts) is persisted per §3.
- **Bounded model context (v1 single thread does not grow unbounded).** Since v1 reuses one
  conversation forever (no new-chat affordance, §3), the stored UIMessage list grows monotonically over
  weeks of use. To keep per-turn token cost and latency bounded, only a **trailing window** of the
  history is sent to the model: before `convertToModelMessages(...)`, slice the loaded UIMessages to the
  **last K messages** (v1 default **K = 20**, tunable in one place) — or an equivalent token budget — so
  the model never receives the entire thread. **The full list is still persisted and rehydrated** for
  `useChat` display; only what is handed to `streamText` is windowed. (Summarization of older turns is a
  v2 candidate, §10.) This is what makes the single-thread model viable on cost; the slice always keeps
  whole UIMessages — never a partial message — so tool-call/result parts are not split.
- **Persistence is an upsert, not a blind insert.** Messages are **upserted on the conflict target
  `(id)`** (the globally-unique `text` UIMessage id stored verbatim, §3 — it is **not** a uuid), so
  re-persisting a message is idempotent and does not create duplicate rows or unbounded growth even if a
  message is written more than once. The `text` PK on `id` (§3) is the conflict target.
  - **Bound the wire payload and the per-turn write too, not just the model input.** The K=20 window
    above bounds only what is handed to `streamText`; the request payload and the DB write would still
    grow monotonically if the client re-sends and the server re-upserts the entire growing list every
    turn. So (a) the client should send only the **trailing/new message(s)** via the v7 send-request
    shaping hook (the `prepareSendMessagesRequest`/`sendExtraMessageFields`-style API — **verify the
    exact v7 name at build time**, per the §2/§6.1 build-time-verification caveat), and (b) persistence
    should upsert only the **new/changed** message(s) for the turn rather than the whole list. The
    upsert remains idempotent on `(id)` either way; this just keeps the payload and write per-turn-bounded,
    consistent with the "viable on cost" goal.
- The managed loop auto-executes **read and non-destructive write** tools and re-prompts;
  `onStepFinish` / `prepareStep` available for control. `experimental_telemetry` enabled so steps
  appear in the AI Gateway dashboard.
- **Human-in-the-loop for destructive and bulk ops.** `deleteTask` and the **dedicated bulk tools**
  (`bulkReschedule`, `bulkComplete`, `bulkDelete`, see §6.2) do **not** auto-execute. They are
  defined with **tool approval** (`needsApproval: true`): when the model calls them, the loop pauses
  and the client renders a confirm/cancel control wired to the v7 `useChat` approval API,
  **`addToolApprovalResponse({ id, approved })`**; the tool runs only after the user approves (a
  declined response returns a tool result saying it was cancelled). The approval card **must render
  which tasks are affected — the title(s) and count** (e.g. "Delete 3 tasks: …" /
  "Reschedule 'Dentist' to Fri") — so the user makes an informed confirm; a bare confirm/cancel without
  the affected set would undermine the F6 safety intent. **Title resolution:** the count comes from the
  tool-call args, but the **ids in the args carry no titles** (`deleteTask`/`bulkDelete`/`bulkComplete`/
  `bulkReschedule` args are `{id}` / `{ids[]}`; only `createTask` args contain `content`). So the card
  resolves each id to a title by **looking it up in the TanStack Query `['tasks']` cache**. When an
  affected id is **not in the cache** (e.g. an overdue task not loaded in the active view), the card
  falls back to showing the id with a **"(not in current view)"** label rather than a title — it still
  shows the accurate count. (Fetching the missing titles on demand for the approval is an acceptable
  alternative; v1 uses the cache-with-fallback to avoid an extra round-trip in the approval path.) This is the mechanism that makes
  PRD F6's "confirm bulk mutations" actually enforceable: because the single-id mutation tools
  (`updateTask`/`rescheduleTask`/`completeTask`) auto-execute, multi-task changes **must** route
  through a bulk tool rather than fanning out into N auto-executing single-id calls inside the
  `stepCountIs(8)` loop — the system prompt instructs the model accordingly (§6.2). Single-task
  `completeTask` is **low-stakes and single-task** (one explicit task, no fan-out), so it
  auto-executes without approval.
- **Hard runtime fan-out guard (does not rely on the model).** The "route multi-task changes through a
  bulk tool" rule above is a prompt instruction, and the prompt alone cannot stop the model from
  emitting several single-id mutation calls across the `stepCountIs(8)` steps (e.g. "mark everything
  done" → seven auto-executing `completeTask` calls with no approval). So in addition to
  the prompt we enforce a **model-independent guard in the tool layer / `prepareStep`**. The guard's
  discriminator is **per-operation, not a global second-mutation cap**: it tracks counts of mutating
  single-id tool-calls **keyed by operation** (`updateTask`, `rescheduleTask`, `completeTask`,
  `deleteTask` counted separately) within a single chat turn, and once the **same operation** is
  attempted on a **second distinct task** in that turn, it blocks auto-execution — the guard aborts that
  call and returns a tool result telling the model to re-issue **that operation's** changes via the
  matching **bulk tool** (`bulkComplete`/`bulkReschedule`/`bulkDelete`; `updateTask` has no bulk tool, so
  a second single-field edit is simply asked to be re-issued as a separate turn). This deliberately does
  **not** trip on **heterogeneous** two-action requests: "move dentist to Friday **and** mark groceries
  done" is one `rescheduleTask` + one `completeTask` (two different operations, one task each), so **both
  auto-execute** without an approval prompt — that is a legitimate single instruction, not a fan-out. The
  thing being stopped is one operation fanning out across many tasks ("mark everything done" → repeated
  `completeTask`), which is exactly what the per-operation count catches at the 2nd call.
  - **Multi-date reschedules and bulkReschedule's single `dueDate`.** `bulkReschedule` applies **one
    shared `dueDate` to all ids** (§6.2), so it cannot encode several tasks going to *different* days in a
    single call. When a turn reschedules multiple tasks to **different** target dates ("reschedule dentist
    to Fri and plumber to Mon"), the model issues **one `bulkReschedule` per distinct target date** (each
    carrying the subset of ids sharing that date, each approval-gated); same-date multi-reschedules are a
    single `bulkReschedule`. Because the guard keys on operation, the *first* reschedule in such a turn
    auto-executes and only the second-distinct-task reschedule is redirected to `bulkReschedule` — so the
    multi-date request is never silently stranded (at worst it costs one extra approval), and §6.2 /
    PROMPTS Phase 5 are written to the same per-operation rule.
  This makes the F6
  "confirm before bulk/destructive mutation" guarantee hold even if the model ignores the prompt;
  a fuzzy "mark everything done" can therefore never fan out past the first auto-executed `completeTask`
  call. The guard is covered by an agent test (§8). The fan-out guard is retained as a cost/blast-radius
  cap, **not** because completion is irreversible: completion is now **recoverable** — there is an Undo
  toast (PRD F2), a global Completed view + per-view "show completed" toggle (PRD F8), and an
  `uncompleteTask` tool (§6.2) that sets `status` back to `'active'` and clears `completed_at`. The
  single-task auto-complete is **deliberately unconfirmed**: the residual risk of a misinterpreted NL
  command completing a task is **low** because it is reversible, and is further mitigated by the
  confirming reply **naming the completed task** (so the user notices immediately) and by this fan-out
  guard (at most one completion is auto-executed).
  - **Multi-task field edits have no bulk path (accepted v1 limitation).** There is no `bulkUpdate`
    tool, so a second same-operation `updateTask` on a distinct task in a turn is blocked by the guard
    and the model is told to re-issue it on a following turn ("set both A and B to p1" applies to A,
    then re-issues B next turn). This asymmetry with the bulk reschedule/complete/delete tools is
    accepted for v1; a `bulkUpdate { ids[], fields }` tool is a v2 candidate (§10).
- **Build-time verification of the tool-approval API (like the model-id note in §2).** The entire
  confirm-before-mutate guarantee (PRD F6) and the bulk/review safety model depend on the AI SDK v7
  human-in-the-loop surface — tool `needsApproval: true` plus the `useChat` approval call
  (`addToolApprovalResponse({ id, approved })`) and the way v7 pauses/resumes a turn around approval.
  These exact identifiers, shapes, and pause/resume behavior **must be confirmed against the pinned
  `ai` / `@ai-sdk/react` version at build time** (check the current AI SDK v7 HITL docs rather than
  trusting the names here, which may have changed). If the real API differs, the HITL design needs
  rework — not a one-line swap — because the safety mechanism rests on it.
- **Known v7 issue.** There is an open AI SDK v7 issue (vercel/ai #10169) where a `useChat`
  `onFinish` callback can break tool `needsApproval`. Because we rely on both, treat `onFinish` cache
  invalidation as best-effort and use the approval-resolution + post-resume invalidation fallback
  described in §4 so refresh is guaranteed even when `onFinish` does not fire on an approval turn.
- The response includes the affected task ids + `tasksChanged` flag (§4) so the client can invalidate
  the `['tasks']` query cache in `useChat` `onFinish`.

### 6.2 Tools (zod-typed, user-scoped)
| Tool | Input | Effect |
|---|---|---|
| `listTasks` | `{ scope: 'today'\|'week'\|'overdue'\|'inbox'\|'all'\|'completed', projectId?, priority? }` | read |
| | **Every scope except `'completed'` excludes `status = 'completed'`** (they return only `status = 'active'`). Scopes are defined against `today(tz)` (§5): **`'today'` = `active AND due_date <= today(tz)`** (overdue **+** today, matching the Today VIEW / PRD F4, so "what's due today" in chat agrees with the view named Today); **`'overdue'` = `active AND due_date < today(tz)`**; **`'week'` = `active AND today(tz) <= due_date <= today(tz)+6`** (the **fixed** rolling next-7-day window; this stays today…+6 even though the Upcoming board can be scrolled past 7 columns — the board horizon is a view affordance, §5, while `'week'` is a fixed window so chat answers stay stable); **`'inbox'` = `active` tasks in the Inbox project regardless of date**; **`'all'` = all `active` tasks**; **`'completed'` = `status = 'completed'` tasks ordered by `completed_at desc`** (backs the Completed view / PRD F8 and lets chat resolve a recently completed task to `uncompleteTask`). `projectId`/`priority` further filter any scope. | |
| `getTask` | `{ id }` | read one |
| `createTask` | `{ content, description?, priority?, dueDate?, projectId? }` | insert; `order = max(order within the task's project) + 1` (base `1.0` if empty), per §5 — the project list is the anchor even when `dueDate` also places it in a board column |
| `updateTask` | `{ id, ...fields }` | update fields (non-date; auto-executes) |
| `rescheduleTask` | `{ id, dueDate }` | change due_date only (auto-executes) |
| `completeTask` | `{ id }` | set completed (auto-executes) |
| `uncompleteTask` | `{ id }` | set `status = 'active'`, clear `completed_at` (auto-executes) — reopens a completed task ("reopen the groceries task"), PRD F8 |
| `deleteTask` | `{ id }` | delete — **`needsApproval`** |
| `bulkReschedule` | `{ ids: string[], dueDate }` | reschedule many — **`needsApproval`** |
| `bulkComplete` | `{ ids: string[] }` | complete many — **`needsApproval`** |
| `bulkDelete` | `{ ids: string[] }` | delete many — **`needsApproval`** |
| `listProjects` | `{}` | read |

**`projectId` ownership check (referential-integrity guard).** App-layer `userId` scoping on `tasks`
(and Neon RLS, if enabled) only constrains `userId`; it does **not** by itself constrain `projectId`, so
a task could otherwise be written referencing a project owned by another user (FK still satisfied).
`createTask`/`updateTask` (and the quick-add server action) therefore **verify the supplied `projectId`
resolves to a project owned by the caller (`where: { id: projectId, userId }`) before insert/update, and
reject otherwise** (a missing/empty `projectId` defaults to the user's Inbox). Covered by an integration
test (§8).

Chat `rescheduleTask`/`bulkReschedule` **intentionally accept any `dueDate`, including past dates**
(an explicit user instruction like "move it back to yesterday" is honored); the `toDate >= today(tz)`
guard is specific to the **review** apply path (§6.3), where a past date would defeat the review's
purpose of moving work to coming days.

Single-id mutation tools auto-execute. **Any single operation that touches more than one task must use
that operation's bulk tool** (which pauses for approval): applying the *same* operation to a 2nd+ task
in one turn is the fan-out the guard blocks (§6.1). A turn may still contain **distinct single-task
operations** that each auto-execute (e.g. one `rescheduleTask` + one `completeTask`) — that is not a
fan-out. `bulkReschedule` applies **one shared `dueDate`** to all its ids; to send several tasks to
*different* days, issue one `bulkReschedule` per distinct target date. This is what makes the F6
"confirm bulk mutations" rule enforceable (§6.1) — without bulk tools, a request like "move all overdue
to next week" would otherwise fan out into N auto-executing `rescheduleTask` calls with no confirm.

**Bulk tool atomicity (matches the review-apply model).** After approval, each bulk tool executes its
whole set in a **single `prisma.$transaction()`** (interactive transaction) in server-only code that is
**all-or-nothing** — a mid-batch failure (e.g. item 7 of 12) rolls back the entire batch so there is no
half-applied state. Like review apply (§6.3), the transaction is **scoped to the authenticated user**
(every statement filters by `userId` from `auth.getSession()`; an id belonging to another user
fails to match and is rejected/skipped, never written) and returns an `{ applied, skipped, tasksChanged }`
summary with a per-item reason for any skip, which the client renders and uses to invalidate `['tasks']`
(§4). This keeps bulk semantics consistent with the transactional review path rather than leaving
partial-failure behavior undefined.

**System prompt rules:** inject today's date computed via `today(tz)` from `profiles.timezone` (§5)
plus the tz name; never invent task ids (always look up first via `listTasks`/`getTask`); a
**date-only change must use `rescheduleTask`** (not `updateTask`) so tool selection is unambiguous
(reflected in the eval set, §8); **applying one operation to more than one task must use that
operation's bulk tool** (`bulkReschedule`/`bulkComplete`/`bulkDelete`), never a series of same-operation
single-id calls — but **distinct single-task operations in one instruction are fine** (e.g. reschedule
one task *and* complete another); to reschedule several tasks to **different** days, call
`bulkReschedule` once per target date (it takes a single shared `dueDate`); destructive and
bulk ops are gated by tool approval (§6.1) — the model proposes them and the user confirms in the UI;
when answering a "this week" question, **state the window explicitly** (e.g. "in the next 7 days
(Jun 28–Jul 4)") so the rolling today…+6 definition is unambiguous and not mistaken for the calendar
week — and because `'week'` (unlike `'today'`) **excludes overdue** for board parity, the reply should
make clear that **overdue work is not counted in the week window and is surfaced under Today instead**
(so a user expecting earlier-this-week-but-now-overdue items is not misled by the asymmetry);
**when the fan-out guard blocks an operation** (§6.1 — e.g. a same-operation field edit on a 2nd task
that has no bulk path, "set both A and B to p1"), the assistant **must explicitly state which task(s)
were applied and which were NOT changed and need a follow-up message**, so a deferred edit is never
silently reported as done; keep replies concise.

### 6.3 Review skill `/api/review` (explicit manual loop / state machine)
The graph-style flow you liked from LangGraph, expressed as plain server code. The endpoint takes a
`mode` discriminator so propose and apply share one route:

**Propose — `POST /api/review { mode: 'propose' }`**
1. **Gather (deterministic):** server queries incomplete tasks (overdue + today, not done), using
   `today(tz)` from `profiles.timezone` (§5). The model does not decide what's incomplete.
   **Empty short-circuit:** if the gathered set is empty, return a friendly "nothing to review"
   result (`{ plan: [], empty: true }`) **without calling `generateObject`** — avoids a wasted model
   call and a malformed/empty plan path.
2. **Propose:** `generateObject` with a zod schema → plan `[{ taskId, fromDate, toDate, reason }]`.
   The result is validated with `schema.parse(...)`; on a schema/parse failure, retry once, then
   surface a graceful error rather than applying a malformed plan (Grok's `generateObject`
   conformance is treated as fallible — see §2 model note). **`toDate` is bounded to the near-term
   planning window:** the schema/prompt constrain `toDate` to **`today(tz) … today(tz)+6`** (the next 7
   days, the board's initial horizon), so the end-of-day review keeps its reorg inside the near-term
   week rather than scattering work far into the future — even though the board can now be scrolled
   beyond +6 (§5), the review intentionally re-places work only within the coming 7 days. The apply step
   (step 4) also flags any item whose `toDate` lands beyond the +6 window in the
   summary as a backstop (`beyond_horizon`), in case the model emits one despite the constraint.
3. **Present:** return the plan to the client; render as a confirmable, editable list. **No DB writes yet.**
   Because review is a **dedicated `/api/review` endpoint and not a `useChat` tool**, the plan is **not**
   a `useChat` message part and must **not** be injected into the `useChat` message stream. It renders in
   a **dedicated review component mounted inside the chat panel** (its own React/TanStack state, separate
   from the `useChat` message list). Cache invalidation for the apply step is wired from **that
   component's apply handler** (`queryClient.invalidateQueries(['tasks'])`), **not** from `useChat`
   `onFinish`.

**Apply — `POST /api/review { mode: 'apply', items: [{ taskId, fromDate, toDate }] }`** (the possibly-edited plan)
4. **Apply on confirm (transactional):** the server applies all reschedules in a **single
   `prisma.$transaction()`** in server-only code, scoped to the authenticated user (see below). For each
   item it re-validates against current
   state — skipping any task that has since been completed, deleted, or whose current `due_date` no
   longer matches the item's supplied `fromDate` (i.e. it was moved out from under the plan), and
   **rejecting any item whose `toDate < today(tz)`** (the review's purpose is to move tasks to *coming*
   days, so a past `toDate` — which `generateObject` could emit — would silently re-create an overdue
   task; such items are skipped with reason `past_date`). `today(tz)` is **re-derived at apply time**,
   so this also covers a **midnight rollover** between propose and apply (propose at 23:5x, apply at
   00:0x the next local day): a target that equalled propose-time "today" is now yesterday and is safely
   **skipped (not errored)** as `past_date`. Because such a skip silently drops an intended move,
   `past_date` skips are **surfaced prominently in the apply summary** so the user can re-run review to
   re-place them. The plan
   is not persisted server-side, so `fromDate` is carried in each apply item: the propose plan already
   contains `fromDate` (step 2), and the client echoes it back unchanged so the apply transaction has a
   propose-time value to compare current `due_date` against — this is what makes the "moved out from
   under the plan" skip (PRD F7 safety) implementable. Applied items commit together (all-or-nothing
   on error); skipped items do not fail the batch.
   - **Security context:** the apply transaction runs in **server-only code scoped to the authenticated
     user** (`auth.getSession()`): every statement filters by `userId`, so a task id belonging to
     another user fails to match and is rejected/skipped — never written. The load-bearing guarantee is
     that the `userId` always comes from the session and never from client input (it must never be taken
     from the request body); a transaction that filtered by a client-supplied `userId` would break
     cross-user isolation, so the session-scoping is load-bearing here (covered by §8).
   - **Response:** `{ applied: [{ taskId, toDate, note? }], skipped: [{ taskId, reason }], tasksChanged: true }`
     (`reason` includes `moved` when current `due_date` ≠ supplied `fromDate`, `past_date` when
     `toDate < today(tz)`, plus `completed`/`deleted`/`not_found`). An item that **applies** but whose
     `toDate > today(tz)+6` (beyond the near-term window — should not happen given the step-2 bound, but
     handled as a backstop) is applied with `note: 'beyond_horizon'` and called out in the summary so the
     user knows it landed outside the coming-week window (reachable by scrolling the board horizon, §5,
     or via the project view).
     The client renders this summary and invalidates the `['tasks']` cache (§4). PRD F7's "reports a
     summary" maps to this per-item `applied` / `skipped` shape.

## 7. Security

**Authorization / isolation — two-layer model.** This is a deliberate posture change from the original
RLS-primary design (see DECISIONS D6 for the stack switch); RLS is no longer the load-bearing boundary,
which is surfaced honestly here.

1. **Enforced v1 boundary = app-layer per-user scoping.** Prisma is **server-only** — there is **no
   browser/PostgREST data endpoint at all** (a structural guarantee the previous data-endpoint design did
   not have). Every
   read/write goes through server actions / a central data-access layer that **always filters by and
   sets `userId` from `auth.getSession()`** on every read/insert/update, **never** from client
   input. A forged or foreign id simply fails to match `where: { id, userId }` → 0 rows, never a
   cross-user read or write. This is the load-bearing equivalent of the old `WITH CHECK` guarantee,
   enforced in the data layer. Covered by integration tests that assert the data-access layer rejects a
   cross-user id and a foreign `projectId` (§8).
2. **Defense-in-depth = Neon RLS (recommended, optional for v1).** Neon RLS policies on every table
   using `auth.user_id()` (derived from the Better Auth session JWT — verifiable via the Neon Auth JWKS
   URL `<NEON_AUTH_BASE_URL>/.well-known/jwks.json`), applied via a raw-SQL Prisma migration. To
   make them effective the app connects with the Neon "authenticated" role and passes the Better Auth JWT
   through the driver adapter **per request**. Because wiring per-request JWT binding through Prisma adds
   real complexity, **v1 MAY ship app-layer-only** and add Neon RLS as hardening; it is documented as
   recommended defense-in-depth, with app-layer scoping the load-bearing v1 boundary either way. If RLS
   ships, an RLS cross-user test is added (§8).
- All tool inputs validated with zod.
- **`projectId` ownership** is verified in `createTask`/`updateTask` and the quick-add server action
  (app-layer `userId` scoping — and RLS, if enabled — constrains only `userId`, not `projectId`); a
  `projectId` owned by another user is rejected via `where: { id: projectId, userId }` (§6.2, tested in §8).
- **Per-user AI rate limit (cost-abuse guard).** `/api/chat` and `/api/review` both call Grok on the
  owner's single shared `AI_GATEWAY_API_KEY`, and signup is open from day one, so without a cap any
  signed-up user could drive unbounded gateway spend. The cap is **scoped to the paths that actually
  invoke the model** — it is incremented and checked **only immediately before the model call**: in
  `/api/chat` right before `streamText`, and in `/api/review` **`mode:'propose'`** right before
  `generateObject` **and after the empty short-circuit** (§6.3 step 1). It is **not** a top-of-handler
  check: `/api/review` **`mode:'apply'`** (§6.3 step 4) makes **no** model call (it is a pure DB
  transaction) and the propose **empty "nothing to review"** return (§6.3 step 1) skips `generateObject`,
  so **both are explicitly exempt** from the cap — a user who already proposed a plan can always apply it
  even when over quota (no lost work), and an empty propose never consumes quota. Over the limit returns
  **HTTP 429** (and the chat surfaces it as the error state below) without calling the model. The counter
  needs no new infrastructure — a small `(user_id, day, count)` row in Neon Postgres, where `user_id` is
  the **Neon Auth (Better Auth) user id** (uuid) from `auth.getSession()` (atomic upsert
  `... ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1 RETURNING count`, or the Prisma
  equivalent) suffices; an Upstash/Vercel KV token bucket is an equivalent drop-in. The **default cap is
  250 model-invoking requests/user/day**; the limit constant lives in one place (tunable).
  - **Owner allowlist (unlimited).** An `OWNER_EMAILS` allowlist constant (containing
    `guoxuan.xu8@gmail.com`) is checked **before** the counter: a request from an allowlisted user
    **bypasses the cap entirely** (the counter is neither checked nor incremented), so the owner is
    never throttled on their own gateway key. The allowlist lives in **one place** alongside the cap
    constant. All non-allowlisted users are subject to the 250/day default. This is **separate from** the K=20 per-turn context window (§6.1), which only bounds cost
  *per call*, not the *number* of calls. **Note:** the counter is keyed per **UTC** day, so a user's
  daily AI quota resets at UTC midnight, not at their local-day boundary — this is the one place "day"
  deliberately diverges from `today(tz)` (§5); it is an accepted simplification for a cost guard, not a
  bug. A richer token-bucket / per-user spend cap is a v2 candidate (§10).
- The only server-side secrets are `DATABASE_URL`/`DIRECT_URL` (Prisma) and **`NEON_AUTH_COOKIE_SECRET`**
  (signs sessions); there is **no service-role-equivalent key**. All are used only in server-only contexts
  and are never reachable from the browser; provisioning is app-layer (`ensureUserProvisioned`, §3), not a
  DB trigger.
- Secrets via Vercel env vars: `DATABASE_URL` (pooled Neon, runtime adapter), `DIRECT_URL` (unpooled,
  `prisma migrate`), `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` (server only, ≥ 32 chars),
  `AI_GATEWAY_API_KEY` (canonical auth path for the
  Gateway).

## 8. Test strategy

- **Unit:** zod schemas, ordering math, board date-bucketing, **project-scoped renormalization** (a
  rebalance triggered from a cross-project board day-column renormalizes only the affected task's
  project `order` set, never the cross-project column — §4/§5), the **cross-view ordering** rule
  (a board day-column reorder rewrites the task's single `order` and the project view reflects the same
  relative order — §5), and the **cross-project tiebreaker** (two tasks from different projects sharing
  the same `order` render in a deterministic order via `ORDER BY "order", created_at, id` in Today and
  each board day-column — §5), and the **overdue-group ordering** (Today's overdue group sorts
  oldest-overdue-first via `ORDER BY due_date ASC, "order", created_at, id`, so a task overdue by 10 days
  renders above one overdue by 1 day — §5/PRD F4), so ties are not flicker-prone.
- **Integration:** server actions / data-access layer against a Neon (or local Postgres) test DB; assert
  the **data layer rejects cross-user access** — a read or write attempted with another user's id matches
  0 rows (the app-layer `userId` scoping, §7), so there is no cross-user read and no forged-`userId`
  write. Also assert the **multi-row write transactions** (`prisma.$transaction()`): a foreign task id
  passed to the review-apply transaction (and to each bulk transaction) is rejected/skipped, never
  written — confirming the per-user session scoping holds (§6.2/§6.3). Also assert the **`projectId`
  ownership check**: `createTask`/`updateTask` with a `projectId` owned by another user is rejected
  (§6.2). **If Neon RLS is enabled** (§7 layer 2), add an RLS test that a connection bound to user A's
  Stack JWT cannot read/write user B's rows even via raw SQL.
- **Agent:** test tool functions directly; scripted chat prompts asserted to call the right tool
  with the right args (mock model or record/replay). Also assert the **per-operation fan-out guard**
  (§6.1): a (mock) model that emits the **same operation** on a second task in one turn is blocked from
  auto-executing it and redirected to that operation's bulk tool — so "mark everything done" cannot fan
  out into multiple auto-executing `completeTask` calls — **while a heterogeneous two-action turn**
  (one `rescheduleTask` + one `completeTask`, different tasks) **both auto-execute** without tripping the
  guard.
- **Tool-selection eval (the PRD ≥80% metric):** an offline, versioned `prompt → expected-tool`
  data set run against the model; the pass rate is the source of the PRD §6 "≥80% resolve to the
  correct tool" figure. The set encodes the disambiguation rules: date-only changes expect
  `rescheduleTask` (not `updateTask`), and multi-task prompts ("move all overdue to next week",
  "mark everything done") expect a **bulk** tool (not repeated single-id calls). Also assert
  `generateObject` review plans satisfy the zod schema (parse + retry), that proposed `toDate` values
  fall within the board horizon (`today(tz)…+6`, §6.3), and that `today(tz)` bucketing
  is correct across timezones (incl. near-midnight cases).
- **E2E (Playwright MCP):** login → add task → see in Today → drag in Upcoming → chat
  "move X to Friday" → verify DB/UI → run review → confirm → verify moves.

## 9. Environments & config
- `.env.local` for dev (loaded by `prisma.config.ts` via dotenv for Prisma CLI); `vercel env` for
  Preview/Production.
- Env vars: `DATABASE_URL` (pooled Neon, `-pooler` host — used by the runtime `@prisma/adapter-neon`),
  `DIRECT_URL` (unpooled — used by `prisma migrate`), `NEON_AUTH_BASE_URL` (the Auth URL from the Neon
  console → Auth), `NEON_AUTH_COOKIE_SECRET` (server only, ≥ 32 chars, `openssl rand -base64 48`),
  `APP_URL` (public origin, no trailing slash — the OAuth issuer for the MCP server, MCP.md §3).
- Prisma client is generated to `src/generated/prisma` (gitignored) and regenerated via a
  `postinstall: prisma generate` script; migrations via `prisma migrate dev` (local) / `prisma migrate
  deploy` (Preview/Production).
- AI Gateway configured with the Grok model string; swappable in one place if Grok terms change.

## 10. Future (v2)
Recurring tasks (RRULE), subtasks (`tasks.parentId` self-FK with `ON DELETE CASCADE`, plus nested
display, complete-parent semantics, and board/Today behavior), labels, sections, **real-time
multi-device sync** (Postgres `LISTEN`/`NOTIFY` or polling — v1 refreshes via cache invalidation, §4),
shared/team projects,
**independent per-context task ordering** (v1 uses one shared `order`, see §5), and
**multi-conversation chat** (list/switch/new threads + derived `conversations.title`; v1 is
single-thread with a bounded trailing-window context, see §6.1), **history summarization** (compress
older turns instead of the v1 fixed last-K window, §6.1), a **`bulkUpdate { ids[], fields }` tool** for
multi-task field edits (v1 has no bulk field-edit path, §6.1/PRD F6), and a **richer AI rate-limit / per-user
spend cap** (token bucket / cost budget; v1 ships only a minimal per-user daily request cap, §7).

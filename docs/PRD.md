# PRD — agenticTODO

**Owner:** Jason (guoxuan.xu8@gmail.com)
**Status:** Draft v1
**Last updated:** 2026-06-28

---

## 1. Summary

A Todoist-style task manager with an **agentic chat panel** layered on top. The chat is the
product differentiator: it answers questions about your tasks, edits tasks via natural language,
and runs a structured **end-of-day review** that looks at incomplete tasks and proposes how to
reorganize and move them across the coming days.

Hosted on Vercel, data on **Neon Postgres**, auth via **Neon Auth (Better Auth)**, multi-user from
day one, agent powered by the Vercel AI SDK calling **Grok (xAI)** through the Vercel AI Gateway.

## 2. Goals

1. A fast, clean Todoist-like UI: **Inbox**, **Today**, **Upcoming (board)**, and projects.
2. A **chat assistant** that can read and modify the user's tasks via natural language.
3. A **review skill**: end-of-day agentic flow over incomplete tasks → proposed reorg → apply on confirm.
4. Secure multi-user auth (magic link + Google) with per-user data isolation (server-only data layer
   scoped per user; Neon RLS as defense-in-depth).

## 3. Non-goals (v1)

- Team / shared projects, collaboration, comments, assignments.
- Native mobile apps (responsive web only).
- Full recurring-task engine (RRULE). v1 uses a single `due_date`.
- Real-time multi-device sync (optional v2 stretch). After a chat/review
  mutation, the affected client views are refreshed by cache invalidation (see F6/F7), not by
  push-based real-time.
- **Multi-conversation chat.** v1 is a **single chat thread per user** (auto-created on first message,
  no new-chat / switch / list UX); multi-conversation is a v2 candidate (see §7). To keep this single
  thread viable on cost as it grows over weeks, only a **bounded trailing window** of history is sent to
  the model each turn (the full thread is still persisted and displayed) — see TDD §6.1; unbounded
  per-turn context is **not** acceptable.

## 4. Personas

- **The owner (power user):** lives in the app daily and drives much of it through chat.
- **A new user:** signs up with email or Google and immediately gets an Inbox + Today view.

## 5. Feature requirements

### F1 — Authentication
- Sign up / sign in with **email magic link** OR **Google OAuth**.
- On first sign-in, auto-provision a `profile` row and a default **Inbox** project.
- On first sign-in, capture the user's timezone from the browser
  (`Intl.DateTimeFormat().resolvedOptions().timeZone`) and store it on the profile; this is the
  single source of truth for "today" across all date-sensitive features (F4/F5/F7, chat).
- The captured timezone is **editable later** via a lightweight **Settings** page (reachable from the
  app shell): a dropdown of IANA zones defaulting to the captured `profiles.timezone` value, which on
  change **re-writes `profiles.timezone`**. After a tz change, invalidate the `['tasks']` queries so
  date-sensitive views (Today/board/chat/review) recompute "today" immediately without a manual reload.
- **Acceptance:** unauthenticated users are redirected to `/login`; after auth they land on **Today**;
  after first sign-in the profile's `tz_captured` flag is true, and a non-UTC browser timezone is
  persisted to `profiles.timezone` (verified by mocking the browser tz to a non-UTC zone in the test;
  a genuine UTC user is captured as `tz_captured = true` with value `UTC`); changing the timezone in
  Settings re-writes `profiles.timezone` and the Today/board views recompute "today" immediately.

### F2 — Task CRUD
- Create / edit / complete / delete tasks with: `content` (title), `description`,
  `priority` (p1–p4), `due_date`, `project`, `order`. (Subtasks/`parent` are **out of scope for v1**;
  see §7 v2 candidates.)
- Quick-add input available on every list view, with **contextual defaults** drawn from the view it is
  used in (Todoist convention), so a quick-added task appears in the view it was added from:
  - In a **project / Inbox** view: `due_date` defaults to null and the task is assigned to that project
    (Inbox when none chosen, F3).
  - In **Today**: `due_date` defaults to `today(tz)` (so the new task satisfies Today's
    `due_date <= today` filter and does not vanish from the view it was added in); project defaults to Inbox.
  - In a **board day-column** (F5): `due_date` defaults to that column's date; project defaults to Inbox.
  - The user can still override these defaults in the quick-add input.
- **Completing is recoverable (Todoist-style).** Completing a task briefly shows a **strikethrough +
  checked** state, then removes it from active lists (sets `status=completed` + `completed_at`), **and
  surfaces a short-lived Undo toast** for instant recovery (Undo sets `status` back to `'active'` and
  clears `completed_at`). Beyond the toast, completed tasks remain recoverable via the Completed view
  (F8).
- **Acceptance:** completing a task shows a brief strikethrough/checked state, then sets
  `status=completed` + `completed_at` and removes it from active lists, with an Undo toast that restores
  it to `active`; a task quick-added in Today (due today) or in a board day-column (due that column's
  date) appears in that view immediately rather than disappearing.

### F3 — Inbox
- Shows tasks in the user's default Inbox project, regardless of due date.
- **Acceptance:** a quick-added task with no project chosen lands in Inbox.

### F4 — Today
- Shows incomplete tasks with `due_date <= today` (including overdue), grouped overdue / today.
  "Today" is computed from the user's stored timezone (F1), not the server's UTC clock.
- **Ordering within groups:** the **overdue** group is sorted **oldest-overdue-first by due date**
  (`ORDER BY due_date ASC, "order", created_at, id`), matching the Todoist convention of surfacing the
  most-overdue work first; the **today** group keeps the cross-project tiebreaker
  `ORDER BY "order", created_at, id` (no date sort needed — all items share the same day). See TDD §5.
- The Today view is a list (no drag & drop). In v1, **rescheduling an overdue task is done via the
  task edit form, chat, or the review flow** — overdue tasks are intentionally not draggable onto a
  board column.
- Quick-add in Today defaults `due_date = today(tz)` (F2) so the new task appears in the Today group
  immediately instead of falling under the Inbox-null default and disappearing from the view.
- **Acceptance:** overdue tasks are visually flagged and ordered oldest-overdue-first by due date; a task
  quick-added in Today appears under the today group right away (due today).

### F5 — Upcoming board (drag & drop)
- Columns = day-columns starting at Today, where "today" is the user's local day (F1); each column
  is a sortable list of that day's tasks. The board **initially shows the next 7 days (Today … +6)**
  but is **horizontally scrollable/extendable beyond 7 columns** — further day-columns lazy-load as the
  user scrolls the horizon forward (or via a configurable horizon) — so future-dated tasks have a
  date-based home on the board rather than living only in their project view.
- Drag a task between columns → updates `due_date` to that column's date.
- Quick-add inside a day-column defaults `due_date` to that column's date (F2) so the new task appears in
  the column it was added in.
- Reorder within a column → updates `order`. There is a single `order` value per task, which is
  **project-scoped and authoritative in the project view**; the board's day-columns (and Today) are
  cross-project lists that display by `order` as a stable secondary sort. Reordering on the board
  therefore rewrites the shared `order` and can also affect the project view — this shared-ordering
  behavior is **accepted in v1** (independent per-view ordering is a v2 candidate); see TDD §5.
- **Known v1 limitation — cross-project intra-column reorder is not position-faithful at ties.** Because
  a single project-scoped `order` float cannot represent a stable arbitrary cross-project ordering,
  intra-column reorder is only guaranteed faithful **among tasks of the same project**. When a card is
  dropped between two cross-project neighbors that share the same `order` value (e.g. several `1.0`s),
  the dropped task's resolved column position falls back to the deterministic
  `ORDER BY "order", created_at, id` tiebreaker rather than the literal drop position, so it may visibly
  snap to a different slot after refetch. The write still succeeds (this is not an error, so rollback
  does not apply). Faithful cross-project drop-position ordering is a v2 item (alongside independent
  per-view ordering); see TDD §5.
- **Acceptance:** the drop persists to the DB; optimistic UI with rollback on error. Drop-position
  fidelity is guaranteed only among same-project tasks in the column (per the limitation above). A task
  quick-added inside a day-column appears in that column (due that column's date).

### F6 — Chat assistant
- Persistent chat panel (right column / drawer) with streaming responses.
- Capabilities:
  - **Q&A:** "what's due today / this week?", "how many p1 tasks are open?" ("today" = active tasks
    with `due_date <= today`, i.e. **overdue + today, matching the Today view / F4**; "this week" = the
    **fixed rolling next 7 days, today…+6** — see TDD §6.2). Note "this week" stays a fixed 7-day window
    even though the Upcoming board can now be scrolled/extended past 7 columns (F5): the board horizon is
    a **view affordance**, while chat's "this week" is a **fixed today…+6 window**, so the two stay
    distinct on purpose. To avoid a
    calendar-week mismatch (a user on Friday may expect "through Sunday"), the chat reply states the
    window explicitly, e.g. "in the next 7 days (Jun 28–Jul 4)", so the rolling definition is clear, and
    notes that overdue items are not part of the week window but appear under Today (since "week" excludes
    overdue for board parity while "today" includes it — see TDD §6.2).
  - **NL mutations:** "move the dentist task to Friday", "add 'buy milk' to inbox", "mark groceries done".
- Backed by typed, user-scoped tools (see TDD). All mutations scoped to the authenticated user.
- **Destructive and bulk ops require confirmation:** deletes and multi-task changes are not executed
  directly by the model. Multi-task changes ("move all my overdue tasks to next week", "mark
  everything done") are expressed as dedicated **bulk tools** (`bulkReschedule`, `bulkComplete`,
  `bulkDelete`) that carry tool approval, so the loop pauses and the user confirms before any DB
  change. Single-task `deleteTask` is likewise gated by approval (TDD §6.1). Once confirmed, a bulk
  change applies **all-or-nothing in a single transaction** and reports an applied/skipped summary
  (matching the review-apply model), so a mid-batch failure leaves no half-applied state.
- **This guarantee does not rest on the model alone.** A model-independent runtime guard caps
  auto-executing single-id mutations **per operation**: applying the **same** operation (e.g.
  `completeTask`) to a second task in one turn is blocked and redirected to the approval-gated bulk path
  (TDD §6.1), so even if the model ignores the rule, a request like "mark everything done" cannot fan
  out into multiple unconfirmed changes. **Distinct single-task
  operations in one instruction still auto-execute** ("move dentist to Friday and mark groceries done"
  is one reschedule + one complete — not a fan-out — and runs without an approval prompt).
- **Low risk — chat single-task completion is auto-executed but recoverable.** A single-task
  `completeTask` from chat auto-executes without an approval prompt, so a misinterpreted NL command can
  complete a task the user did not intend. This is now **low risk because completion is reversible**:
  it is mitigated by (a) the confirming reply, which **names the task it completed** so the user notices
  immediately, (b) the Undo toast + the **Completed view & `uncompleteTask`** (F8), which let the user
  restore the task to `active`, and (c) the fan-out guard above, which caps a fuzzy "mark everything
  done" at the single first auto-executed completion. The fan-out guard remains in place as a
  cost/blast-radius cap even though individual completions are now recoverable.
- **Known v1 limitation — multi-task field edits need separate turns.** There is no `bulkUpdate` tool,
  so a request that changes the same non-date field on more than one task ("set both A and B to p1")
  applies to the first task and the fan-out guard then blocks the rest (bulk *reschedule/complete/delete*
  exist; bulk field-edit does not). Because there is no automatic following turn within one request, the
  assistant **must explicitly tell the user which task(s) it changed and which were not applied and need a
  follow-up message** — so the user is never misled into thinking both were set when only one was (TDD
  §6.2). This is accepted for v1; a `bulkUpdate` tool is a v2 candidate (§7).
- **Acceptance:** a natural-language command that maps to a tool produces the correct DB change and a
  confirming reply; a delete and any bulk change are not applied until the user confirms in the
  approval UI, which shows the affected task title(s)/count before confirming; a blocked second
  same-operation field edit ("set both A and B to p1") applies the first task and produces a reply that
  **names the un-applied task(s)** as needing a follow-up message (not silently dropped); after a
  mutation, the affected Today/board/project views refresh automatically (cache invalidation, no manual
  reload).

### F7 — Review skill (agentic flow)
- Triggered by a **Review button** in the chat panel (the review is a dedicated `/api/review` flow,
  not a chat tool, so it is not invoked by typing a free-text phrase into the chat in v1 — see TDD §6.3).
- Flow: gather incomplete tasks (overdue + today not done, using the user's local "today") → model
  analyzes and proposes a reschedule/reorg plan (which task → which day, and why) → user reviews the
  plan → on **confirm**, apply the moves; user may edit before applying.
- Apply is all-or-nothing within a single transaction; items whose task changed between propose and
  apply (already completed/deleted/moved), or whose proposed target day is in the past (the review
  only moves work to *coming* days), are skipped and listed in the summary rather than failing
  the batch.
- **Acceptance:** nothing is moved until the user confirms; applying performs the proposed
  `due_date` changes in one transaction and reports a per-item summary (applied + skipped); after
  apply, the Today/board views refresh automatically.

### F8 — Completed view & uncomplete
- A lightweight **Completed** surface so completions are recoverable beyond the F2 Undo toast:
  - A **global Completed filter/view** listing recently completed tasks ordered by `completed_at desc`.
  - A **per-project / per-view "show completed" toggle** that reveals that view's recently completed
    tasks inline (also ordered by `completed_at desc`).
- From either surface the user can **Uncomplete** a task — sets `status` back to `'active'` and clears
  `completed_at`, returning it to the active lists. Chat can also uncomplete via natural language
  ("reopen the groceries task") through the `uncompleteTask` tool (TDD §6.2).
- **Acceptance:** completing a task makes it appear in the Completed view ordered by `completed_at desc`;
  uncompleting it (from the view, the per-view toggle, the F2 Undo toast, or chat) sets it back to
  `active`, clears `completed_at`, and it reappears in the relevant active lists.

## 6. Success metrics
These are **aspirational, non-gating** targets for v1 unless an instrumentation method is in place:
- Time-to-first-task after signup < 30s — measured via an analytics event timestamp (signup →
  first task created) if/when analytics is added; otherwise aspirational.
- ≥ 80% of chat commands resolve to the correct tool action without retry — measured by the offline
  prompt→expected-tool eval set in TDD §8, not by production traffic.
- Review flow completes (gather → confirm → apply) in a single session without manual DB cleanup.

## 7. Open items / risks
- **Per-user AI rate limit / cost cap (required in v1).** Because signup is open from day one and every
  user's chat/review calls bill the owner's single shared `AI_GATEWAY_API_KEY`, the `/api/chat` and
  `/api/review` endpoints **must** enforce a minimal **per-user daily request cap** (a simple counter).
  The default cap is **250 model-invoking requests/user/day** (chat turns + review propose), so a
  signed-up user cannot drive unbounded Grok calls on the owner's gateway key. The **owner email
  (`guoxuan.xu8@gmail.com`) is allowlisted to unlimited** via an `OWNER_EMAILS` constant checked before
  the counter — allowlisted users bypass the cap entirely. The cap default and the allowlist both live in
  **one place**. This is a production / cost-abuse safeguard, distinct from the per-turn context bounding
  (K=20 window) that only caps cost-per-call; see TDD §7. A richer token-bucket / spend cap is a v2 candidate.
- **Grok free terms** can change — confirm current limits at console.x.ai. AI Gateway lets us
  swap the model with a one-line change if needed.
- **Vercel Hobby is non-commercial** — fine for building; upgrade to Pro before charging users.
- v2 candidates: recurring tasks, subtasks (`parent_id`), labels, sections, Realtime sync, shared
  projects, independent per-view task ordering, and a `bulkUpdate { ids[], fields }` tool for
  multi-task field edits (F6).

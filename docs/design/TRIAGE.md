# Overdue triage (chat-triggered, one pass, one approval) — Feature Spec & Build Plan

> **Superseded.** Written for an in-app chat assistant that was later removed in favour of the
> MCP server (see [DECISIONS.md](DECISIONS.md) and [AGENT.md](../AGENT.md)); the source files it
> links to no longer exist. Kept as design history.

**Owner:** Guoxuan Xu
**Status:** Draft v2 — supersedes v1 wholesale (2026-08-01, owner review)
**Last updated:** 2026-08-01
Companion docs: [PRD.md](./PRD.md) · [TDD.md](./TDD.md) · [PROMPTS.md](./PROMPTS.md) · [DECISIONS.md](./DECISIONS.md) · [ROUTINES.md](../ROUTINES.md) · [ESTIMATES.md](../ESTIMATES.md)

> **v1 → v2.** Draft v1 designed a durable state machine: `TriageRun`/`TriageItem` tables, a
> cursor, per-item clarifying questions under a budget, resumability. Owner review killed it on the
> right grounds: the success metric is **task-management time (30 min → 5 min)**, and v1 spent that
> budget on questions — the machinery existed to make a long interactive loop survivable, but the
> loop was only long *because it asked questions*. v2 inverts the design: **one autonomous pass,
> zero questions, one approval**. Confident defaults you can flip beat questions you must answer.
> A pass that finishes in one request needs no run table — the plan itself is the state, and it
> lives in the chat message, which the app already persists. What survives from v1: the closed
> verdict enum, `pushCount`, code-side capacity balancing, and apply-time re-validation.

---

## 1. Summary

You say **"clear my overdue"** in chat. The agent runs one autonomous pass over every overdue task
— reading signals the app will now record, deciding a *fate* for each (not just a new date),
balancing the result against the week's real capacity — and posts a **digest** into the
conversation: 23 rows, each with a verdict and a one-line reason. You flip the two or three rows it
got wrong and tap **Approve**. One transaction applies everything. Total attention: 2–3 minutes.

This is the standard agentic shape (per Anthropic's *Building Effective Agents* and the AI SDK's
own HITL design): a **well-defined task gets a workflow with one human gate**, not a conversation.
The model does the one thing only it can do — look at `"samsung work"`, three weeks overdue, pushed
six times, and say *a seventh date is not the answer* — and code does everything else: gathering,
capacity math, routing, applying. The human's role is a single approval over an editable plan, which
is the cheapest possible way to stay in the loop.

The existing `/api/review` two-phase propose/apply was already this shape in miniature — it is
superseded, not because it was wrong, but because it is weak on three axes: its only verdict is "a
different day", it sees no signals (`pushCount` does not exist yet), and it lives in a bolt-on panel
instead of the conversation. The chat agent ([`route.ts`](../../src/app/api/chat/route.ts)) is already
the standard loop — `streamText` + tools + `stopWhen` + `needsApproval` — so triage becomes **a tool
that agent owns**, not a parallel subsystem.

### Decisions (owner-decided 2026-08-01)

- **DT1 — Chat is the trigger; the pass is a tool.** Triage starts by talking to the assistant
  ("clear my overdue", "help me deal with this pile"), which calls a `triageOverdue` tool. A
  quick-action button may exist, but it just sends the canned message — exactly how the Review
  Inbox button already works ([`chat-panel.tsx:129-143`](../../src/components/chat/chat-panel.tsx#L129-L143)).
  One agent, one surface, one conversation history; and "also go through my inbox" later is the
  same conversation, not another subsystem.

- **DT2 — One pass, zero questions.** v1's clarifying-question loop is deleted, not bounded. Every
  ambiguity resolves to a *confident default plus an editable row* in the digest. Flipping a wrong
  verdict costs one click; answering a question costs a context switch. This is the decision that
  actually delivers 30 → 5 minutes, and it is also what makes all of v1's durability machinery
  unnecessary: a pass that completes inside one chat turn has nothing to resume.

- **DT3 — The plan is the state, and it lives in the message.** The tool's output — the full plan
  JSON — is a tool part on the assistant message, and messages are already persisted verbatim to
  Postgres and rehydrated on panel open (`Message.content`, TDD §3; [`conversation.ts`](../../src/lib/ai/conversation.ts)).
  Reload the page mid-triage and the digest is still there, **for free**. No `TriageRun` table, no
  cursor, no new schema beyond `pushCount`. Idempotency comes from apply-time re-validation (DT8),
  not from run bookkeeping.

- **DT4 — Verdicts are a closed enum, not free text.** *(kept from v1)*
  `do_today | reschedule | unschedule | split | drop | already_done`. The model emits a label plus
  a typed payload; code routes on the label. `unschedule` earns its place because a large share of
  chronic overdue is tasks that should never have carried a date — without it, the only way to stop
  a task nagging is to lie about when you'll do it.

- **DT5 — `pushCount` counts *distinct days of dodging*, and triage's own moves count.**
  The highest-value input to the verdict is currently unknowable — `Task` records nothing between
  `createdAt` and `updatedAt`, so *slipped once* and *dodged daily for a month* look identical.
  `pushCount` increments **iff an active task that is due today-or-earlier is moved to a date after
  today, at most once per task per user-local day** (`lastPushedOn` dedups). This definition is
  what survives the failure modes (red-teamed 2026-08-01, §3.2): shuffling *future* tasks around
  the board is planning, not avoidance — never counted; moving an overdue task *to today* is
  recommitment — never counted (so triage's own `do_today` cannot inflate the signal it consumes);
  same-day waffling counts once. Triage's `reschedule` verdicts do count — a run that laundered
  its own history would make the pile look healthier every time it ran. Semantics: `pushCount: 6`
  = six separate days this task stared at the user and they blinked.

- **DT6 — Destructive verdicts are opt-in rows; everything else is opt-out.** In the digest,
  `reschedule` / `do_today` / `unschedule` rows start **included**; `drop` / `split` /
  `already_done` rows start **excluded** and must be ticked. One Approve tap is still the only
  gesture, but a destructive change can never ride in unnoticed on a bulk approve. (`already_done`
  is destructive on purpose: silently completing something you didn't do corrupts the history that
  Activity and estimate analytics stand on.)

- **DT7 — Capacity is balanced in code, after classification, across all items.** *(kept from v1)*
  Twelve independent "do it today" verdicts make an impossible day. The balancer runs after the
  model, over all proposals at once, seeded with each day's already-committed estimate load —
  reusing `sumEstimates` (ESTIMATES §3.2) and inheriting DE5's rule: **unsized tasks consume no
  capacity and are reported separately**, never assigned an invented default.

- **DT8 — Apply is client → server, never through the model, and re-validation is the idempotency.**
  The digest's Approve posts the (possibly edited) plan straight to `/api/triage` — the model never
  round-trips the edited items (token cost, transcription risk, zero benefit). Each item is
  re-validated in the transaction against current state exactly as `applyReviewPlan` does today
  (`not_found` / `completed` / `moved` / `past_date`), so a double-tap or replayed request finds
  every already-applied item `moved`/`completed` and skips it. Same pattern, extended per verdict.

- **DT9 — `/api/review` is superseded, not forked.** It stays live and untouched until the digest
  path fully replaces it (final phase), then route, panel, and its apply path are deleted. Two
  overlapping reschedule paths would be worse than either alone.

### Deliberately dropped from v1

| v1 piece | why it's gone |
|---|---|
| `TriageRun` / `TriageItem` tables, cursor, status machine | nothing to resume when the pass fits in one turn; the persisted message is the durable plan (DT3) |
| Clarifying-question loop + budgets (1/item, 8/run) | questions were the time cost the feature exists to eliminate (DT2) |
| Per-item confidence gate for auto-staging | one plan-level approval gate replaces per-item routing; confidence survives only as a display hint on the row |
| `/api/triage` mode machine (`start`/`classify`/`answer`/`decide`/`abandon`) | apply is the only server mode left; propose happens inside the chat tool |

---

## 2. Product requirements

### Goals

- Go from "23 overdue" to "0 overdue, every item deliberately dispatched" in **under 5 minutes**,
  most of it the agent's time rather than yours.
- Let the answer be **"no"** — drop, unschedule, split — not only "which day instead".
- One approval gesture per triage, over a plan where any row can be flipped first.
- Never produce a plan that overloads a day; never invent a size for an unsized task.
- Survive a reload: the digest is in the conversation, and the conversation is persisted.

### Non-goals (v1 of this feature)

- Scheduled/background triage (cron). The trigger is conversational by owner decision (DT1);
  a morning cron that pre-runs the pass is the natural v2 once the digest is trusted.
- Auto-applying anything without the Approve tap — even confident reschedules.
- Inbox refinement. Same digest pattern later (proposed *rewrites* instead of proposed dates),
  same conversation; separate feature.
- Rewriting task titles. Triage decides a task's fate, not its wording.
- Learning from past runs ("you always drop errands") — possible once applied plans accumulate.

### Behavior spec

**Trigger.** "Clear my overdue" / "let's triage" / the Triage button (which sends that message).
The agent calls `triageOverdue`. An empty pile returns `{ empty: true }` and the agent just says so
— no plan, no digest.

**The pass.** One tool call: gather active tasks due on/before today with their signals → model
classifies every task (chunked if the pile is large) → balancer places dated verdicts across
today…+6 against committed estimate load, spilling overflow forward; anything past the horizon is
downgraded to a proposed `unschedule` with reason `no_capacity`. The tool returns the finished plan.

**The digest.** Rendered in the message stream as a card (a custom tool-part renderer, replacing
the generic "· toolName" line for this tool): one row per task — content, days overdue, push count,
verdict badge, target date where relevant, one-line reason. Each row: an include-checkbox (per
DT6 defaults) and a verdict/date override. Footer: what's included ("14 reschedules · 3 drops · 2
unscheduled"), the week's resulting load per day, an unsized-task count, and **Approve**.

**Apply.** Approve posts included rows to `/api/triage`. Transactional; per-item re-validation;
per-verdict effects (§3.5). The response summary renders under the digest (applied / skipped and
why / overdue before → after), and the tasks cache invalidates.

**After.** The digest card in history flips to its applied state (summary shown, controls
disabled). Tapping Approve on a stale rehydrated digest is safe: every item re-validates and skips.

### Acceptance

- "clear my overdue" with 23 overdue tasks yields a 23-row digest in the conversation, with
  exactly **one** approval gesture between you and an empty overdue list.
- Wall-clock user attention for a 23-task triage — scan, flip a few rows, approve — is under 3
  minutes; nothing in the flow asks the user a question.
- A task pushed 6+ times draws `drop`, `split`, or `unschedule` — never a seventh plain date.
- A missed-routine catch-up (`fromRoutineId` set) that keeps being pushed is proposed for `drop`.
- `drop` / `split` / `already_done` rows arrive **unticked**; approving without touching them
  applies only the non-destructive rows.
- A day already carrying 4h of committed estimates receives no additional `do_today`/`reschedule`
  placement; overflow lands on the next day with room or degrades to `unschedule (no_capacity)`.
- Ten unsized overdue tasks don't silently fill a day; the digest reports them as unsized.
- Reloading the page after the digest renders shows the same digest, still approvable.
- Double-tapping Approve (or replaying the request) applies each item exactly once — the second
  pass reports all items skipped.
- A task completed in another tab between digest and Approve is skipped with reason `completed`;
  the rest still commit.
- A task due today-or-earlier moved past today — by triage's `reschedule`, by drag, by chat — has
  `pushCount` one higher; but: shuffling *future* tasks around the board never counts, moving an
  overdue task *to today* (incl. triage's `do_today`) never counts, moves earlier / to no-date
  never count, completed tasks never count, and pushing the same task twice in one day counts once.
- After apply, the summary shows overdue before → after and the Today view agrees.

---

## 3. Technical design

### 3.1 Schema

Two columns, one migration (`add_push_count`). **No new tables** (DT3).

```prisma
  /// Distinct user-local days this task was due/overdue and got moved past today (DT5, §3.2).
  /// The signal that separates "slipped once" from "dodged for a month"; triage's own
  /// reschedule verdicts count it, its do_today verdicts deliberately don't.
  pushCount    Int     @default(0) @map("push_count")
  /// User-local 'YYYY-MM-DD' of the last counted push. Load-bearing twice (§3.2): the
  /// once-per-day dedup AND, evaluated inside the UPDATE's WHERE, the concurrency guard.
  lastPushedOn String? @map("last_pushed_on")
```

### 3.2 `pushCount` maintenance (`src/lib/data/tasks.ts`)

**The rule** (red-teamed 2026-08-01; the failure cases below are why each condition exists). On
every `dueDate` write to an *existing* task, with `today = todayStr(profiles.timezone)` computed
server-side at write time, count a push **iff ALL of**:

| # | condition | kills this failure mode |
|---|---|---|
| 1 | `status = 'active'` | completed tasks accruing pushes via the edit dialog / chat `bulkReschedule` (neither filters status) |
| 2 | old `dueDate` IS NOT NULL and ≤ `today` | board shuffling of *future* tasks counting as avoidance |
| 3 | new `dueDate` IS NOT NULL and **> `today`** | past→past moves (Mon→Tue while overdue since Mon — still overdue, nothing dodged) and moves *to* today (recommitment; triage's `do_today` must not inflate the signal it consumes). Given #2 this strictly subsumes "later than old". |
| 4 | `lastPushedOn` IS NULL OR ≠ `today` | same-day waffling (today→tomorrow→today→tomorrow = 1, not 2). `≠`, not `<`: a westward timezone change (D1) replays a day and must not double-fire. |

Effect: `pushCount + 1`, `lastPushedOn = today`. Never decrement; clears and earlier/equal moves
change nothing; creates never count (no old value).

**Implementation shape — the conditions live in SQL, not JS.** A read-then-decide-then-write guard
races: two concurrent moves both read the old row, both pass #4 on stale state, both increment.
All four conditions go in the `WHERE` of a guarded `updateMany` against the **old** row — under
READ COMMITTED the second writer re-checks the WHERE after the row lock and matches nothing. One
shared helper (`countPushes(tx, ids, today)`), because there are **three write paths that bypass
`updateTask`** and each needs it: `bulkReschedule` (`tasks.ts:272`), `applyReviewPlan`
(`review.ts:64`) while it lives, and the triage apply (§3.5). In the bulk paths the helper runs
*before* the date write, inside the same transaction — after, and it compares the new date to
itself.

Known accepted leaks (each needs deliberate multi-step gaming; patching them would poison honest
paths): clear-the-date-then-redate-later, and complete→move→uncomplete. The 23:59/00:01
double-count and the ±1 from a timezone flip are quirks of the "distinct user-local days"
definition, accepted.

`pushCount` joins `TaskDTO` and `brief()` in `src/lib/ai/tools.ts` — per ESTIMATES §3.6, a field
the model can write-around but never read is a field it reasons about blind. (`lastPushedOn` stays
server-only; it is bookkeeping, not a signal.)

### 3.3 The pass (`src/lib/ai/triage.ts`)

```
gather (code)     tasks due ≤ today + signals; per-day committed load for today…+6
   ↓
classify (model)  generateObject, chunks of TRIAGE_CHUNK_SIZE; retry once per chunk
   ↓
balance (code)    place dated verdicts against capacity; overflow → next free day;
                  past horizon → unschedule (no_capacity)
   ↓
plan              returned by the tool; rendered as the digest
```

`runTriagePass(ctx): Promise<TriagePlan>` — callable from the chat tool now, from a cron route in
v2 unchanged.

Classifier schema per item: `taskId`, `verdict` (the DT4 enum), `confidence` (0–1, display hint
only), `reason` (≤200 chars), `toDate?`, `splitInto?` (≤5 titles). Signals per task: `content`,
`description`, `daysOverdue`, **`pushCount`**, `priority`, `estimate`, project name,
`isRoutineCatchUp` (`fromRoutineId !== null`), age since `createdAt`. Run-level: `today` and the
7-day committed-load vector. The prompt discourages plain `reschedule` at
`pushCount >= PUSH_COUNT_STALE` and steers catch-ups per ROUTINES §RV7 (a repeatedly-pushed
catch-up means the routine isn't happening; another date is the wrong answer).

Model economics: classification is batched because it has no cross-item dependency — a 23-task
pile is 1–2 `generateObject` calls, not 23. Against `DAILY_REQUEST_CAP` (250/day) and the Gemini
free tier, per-item calls would be pure waste.

### 3.4 The chat tool (`src/lib/ai/tools.ts`)

```ts
triageOverdue: tool({
  description: "Run a full triage pass over the user's overdue tasks and return a plan " +
    "for the digest UI. Call when the user wants to process/clear/deal with overdue work. " +
    "Do NOT restate the plan row-by-row in text — the UI renders it; give a 1–2 sentence summary.",
  inputSchema: z.object({}),
  execute: async () => runTriagePass(ctx),
})
```

- `ToolContext` gains `email`, because the tool consumes one AI request itself: the pass's inner
  `generateObject` calls `consumeAiRequest` immediately before the model call, same posture as
  every other model call in the app (TDD §7).
- No `needsApproval` on this tool — proposing is read-only; the approval gate is the digest's
  Approve (DT8). The system prompt gets a short TRIAGE section replacing nothing (the INBOX REVIEW
  section stays for now).

### 3.5 Apply (`src/app/api/triage/route.ts` + `src/lib/data/triage.ts`)

`POST /api/triage` — apply only, no model, not rate-limited (mirrors review's apply half):

```ts
{ items: [{ taskId, fromDate, verdict, toDate?, splitInto? }] }
```

One `prisma.$transaction`, per item: re-validate (`not_found` / `completed` / `moved` — current
`dueDate` ≠ `fromDate` — / `past_date` for dated verdicts), then per verdict:

| verdict | effect |
|---|---|
| `do_today` / `reschedule` | set `dueDate = toDate`; the §3.2 guard runs — so `reschedule` (toDate > today) counts a push and `do_today` (toDate = today, recommitment) deliberately doesn't |
| `unschedule` | `dueDate = null` |
| `drop` | delete the task |
| `split` | create `splitInto` tasks (same project/priority, no date), delete the parent |
| `already_done` | `status = 'completed'`, `completedAt = now()` |

Response `{ applied, skipped, overdueBefore, overdueAfter, tasksChanged }` — the before/after pair
computed inside the transaction, so the digest summary and reality can't disagree.

Session-scoped `userId` on every statement, as TDD §6.3 requires; `fromDate` echoes through the
client exactly as review's apply items do today, which is what makes the `moved` skip — and with
it the idempotency (DT8) — implementable without server-side plan storage.

### 3.6 Digest UI (`src/components/chat/triage-digest.tsx`)

Rendered from `chat-panel.tsx`'s part loop: where tool parts currently fall through to the generic
"· toolName" line ([`chat-panel.tsx:211-215`](../../src/components/chat/chat-panel.tsx#L211-L215)),
a `tool-triageOverdue` part in `output-available` state renders `<TriageDigest plan={part.output}>`
instead. Local component state holds row inclusion/overrides (pre-apply edits are ephemeral by
design — the persisted artifact is the *proposed* plan; the *applied* outcome arrives in the apply
response). Approve posts to `/api/triage`, renders the returned summary, and invalidates
`TASKS_KEY` from its own handler — the same wiring rule review-panel follows (TDD §6.3: never from
`useChat` `onFinish`).

### 3.7 Config (`src/lib/ai/config.ts`)

```ts
export const TRIAGE_CHUNK_SIZE = 15;
export const DAILY_CAPACITY_MIN = 240;  // balancer cap per day, committed estimates
export const PUSH_COUNT_STALE = 4;      // at/above: prompt discourages another plain reschedule
```

(`AUTO_APPLY_CONFIDENCE`, `QUESTIONS_PER_ITEM`, `QUESTIONS_PER_RUN` from v1: never created.)

---

## 4. Build phases

Each phase ends runnable; `/api/review` stays live untouched until T4.

### Phase T1 — the signal

> **Prompt:** Add `pushCount` + `lastPushedOn` to `Task` per §3.1; migrate as `add_push_count`.
> Build the shared `countPushes` guard per §3.2 — all four conditions in the `WHERE` of a guarded
> `updateMany`, run before the date write, in-transaction — and call it from `updateTask`,
> `bulkReschedule`, and `applyReviewPlan`. Thread `pushCount` (not `lastPushedOn`) through
> `TaskRow`/`SELECT`/`toDTO` in `src/lib/data/tasks.ts`, `TaskDTO`, and `brief()` in
> `src/lib/ai/tools.ts`.

**Done when:** dragging an *overdue* task to a later column bumps `pushCount` once per day;
shuffling future tasks, moving overdue→today, and date-editing a completed task all leave it
untouched; and the chat agent can answer "which tasks have I pushed the most?".

### Phase T2 — the pass and the tool

> **Prompt:** Build `src/lib/ai/triage.ts` per §3.3 (gather with signals + committed-load vector,
> chunked `generateObject` with one retry per chunk, code balancer reusing `sumEstimates`). Add the
> §3.7 constants. Register `triageOverdue` per §3.4, extending `ToolContext` with `email` and
> consuming one AI request inside the pass. Add a TRIAGE section to the chat system prompt.

**Done when:** "clear my overdue" in chat produces a valid balanced plan (visible in the tool part /
model's summary text), 23 tasks cost ≤2 inner model calls, a `pushCount >= 4` task draws a
non-reschedule verdict, and no proposed day exceeds `DAILY_CAPACITY_MIN`.

### Phase T3 — the digest and the apply

> **Prompt:** Build `src/app/api/triage/route.ts` + `applyTriagePlan` in `src/lib/data/triage.ts`
> per §3.5. Build `src/components/chat/triage-digest.tsx` per §3.6 with DT6 include-defaults and
> per-row verdict/date override; special-case the part type in `chat-panel.tsx`. Add a Triage
> button beside Review Inbox that sends the canned trigger message.

**Done when:** every acceptance bullet passes end-to-end from the chat panel, including the
double-apply and reload bullets.

### Phase T4 — retire review

> **Prompt:** Delete `/api/review`, `review-panel.tsx`, and `applyReviewPlan` (keep
> `gatherIncomplete`, now imported by the pass). Remove the ReviewPanel mount. Update TDD §6.3 to
> describe the triage tool + digest instead.

**Done when:** one triage path exists; grep finds no reference to the review route or panel.

---

## 5. Deferred (v2 candidates)

- **Morning cron** — `runTriagePass` is trigger-agnostic by construction (§3.3); a Vercel cron
  route runs it and posts the digest as an assistant message into the (single, TDD §3) conversation
  so the plan is waiting with coffee. Approving stays human-only.
- **Inbox refinement on the digest pattern** — same shape, different columns: proposed *rewrite*,
  project, estimate, date per inbox task; one approve. Replaces the prose INBOX REVIEW workflow in
  the chat system prompt ([`route.ts:35-42`](../../src/app/api/chat/route.ts#L35-L42)).
- **Auto-apply tiers** — once digest accuracy is trusted: cron applies non-destructive reschedules
  itself and the digest shrinks to destructive-only. Explicitly out until trust is earned (DT6).
- **Learning from edits** — the apply payload records every human override of a proposed verdict;
  "you flip `drop`→`reschedule` 80% of the time for errands" is a future prompt input.
- **Undo an applied plan** — the apply summary contains everything needed to reverse-apply.
- **Estimate-aware balancing beyond +6** — the balancer gives up at the week horizon; ESTIMATES §5
  already lists load-balancing as v2.

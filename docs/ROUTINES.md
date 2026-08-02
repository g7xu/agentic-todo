# Routines (daily recurring tasks) — Feature Spec & Build Plan

**Owner:** Jason (guoxuan.xu8@gmail.com)
**Status:** Draft v1
**Last updated:** 2026-07-14
Companion docs: [PRD.md](./PRD.md) · [TDD.md](./TDD.md) · [PROMPTS.md](./PROMPTS.md) · [DECISIONS.md](./DECISIONS.md)

---

## 1. Summary

Add **routines**: task definitions that recur every day ("stretch", "read 20 pages"). A routine is a
*template* that spawns one real `Task` row per local day (a *materialized instance*). Instances flow
through the existing views, completion logic, agent tools, and completed history untouched — the only
new machinery is the spawn/sweep step and routine CRUD.

### Decisions (owner-decided 2026-07-14)

- **DR1 — Template + materialized instances**, not a Todoist-style rolling task (one row whose
  `dueDate` advances on completion). Rationale: instances are ordinary `Task` rows, so every existing
  code path (Today, complete/uncomplete, Completed view, chat tools, `timeUsed`, ordering) works with
  zero special-casing, and per-day history (streaks, misses) is queryable for the agent. Cost: ~365
  rows/routine/year — negligible on Neon.
- **DR2 — Lazy materialization on read, no cron.** Instances spawn inside the tasks read path on the
  user's next visit, computed against `Profile.timezone` (`todayStr(tz)`, `src/lib/date.ts`). No
  midnight job exists, so nothing breaks when the app has no traffic (serverless-friendly); state
  converges on read. Idempotency/races are handled by a DB unique on `(routine_id, due_date)`. Days
  the user never opened the app get **no instance rows** — a gap in the rows *is* the record of
  "didn't show up", distinct from `missed` ("saw it, didn't do it"). A Vercel Cron is added only
  when/if proactive features (notification digest, agent outreach) land — it would reuse the same
  materialize function.
- **DR3 — Miss semantics: sweep to `missed`, freely reversible.** When today's instance spawns, any
  *stale active* instance of a skip-mode routine (`due_date < local today`) is flipped to
  `status = 'missed'` — a default assumption, not a verdict. Backfill ("I did it, forgot to check it
  off") is just `missed → completed`: `dueDate` keeps the day it was *for* (stats stay truthful),
  `completedAt` records when it was confirmed. No grace window (it re-creates pile-up and still needs
  backfill). Per-routine `onMiss = 'carry'` opt-in for accumulating chores ("water plants"): the stale
  instance is rescheduled to today instead of swept.

## 1.1 Revisions — 2026-07-14, post hands-on review (supersede conflicting text below)

After playing with the built feature, the owner revised three decisions. Where the sections below
conflict with these, **these win** (kept for history rather than rewritten):

- **RV1 — Instance dates are locked.** Rescheduling a routine instance is blocked at the data
  layer (`updateTask` rejects a changed `dueDate` when `routineId` is set; `bulkReschedule` skips
  them with reason `routine_date_fixed`, which also covers agent tools). Edit dialog shows the
  date read-only; board cards with a `routineId` aren't draggable. Same-date writes pass so board
  reorders keep working. The spawner's "instance dated today **or later** exists" check stays as
  a safety net (protects against duplicate spawns after e.g. a westward timezone change).
- **RV2 — Always carry; `onMiss` removed (supersedes DR3).** An unfinished instance always rolls
  forward to today — a routine never piles up and never silently disappears. The `on_miss` column
  was dropped (migration `routines_always_carry`), the skip/carry option removed from the UI, and
  the **missed-recap strip removed** (nothing is ever swept to `missed` in normal operation, so it
  had nothing to show; `listTasks` no longer returns `missed` rows at all). `status = 'missed'`
  survives only as an internal parking state: leftovers of **paused** routines (so they don't
  follow the user around while paused) and rare carry collisions.
- **RV10 — A ghost is clickable, and a missed routine leaves only a record (2026-08-02).** Two
  owner-requested changes to how a routine occurrence enters and leaves the board.

  **A. Clicking a ghost materializes it.** RV6 gave ghost cards exactly one gesture — tick the
  circle to complete ahead of time — and left the rest of the card inert, so the one occurrence you
  could see coming was the one you could not size, annotate, or re-prioritize. Clicking anywhere
  else on a ghost now calls `materializeOccurrence`, which is `completeOccurrence` with
  `status: 'active'` instead of `'completed'` (both are thin wrappers over one guarded
  `createOccurrence`, so the RV6 guards — owned, active, scheduled-based, on-cadence, not in the
  past — apply unchanged). The row is created on **its own date**, and the board opens the edit
  dialog on it. What you get is an ordinary routine instance, identical to the one that day's spawn
  would have produced: editable, completable, deletable, and date-locked by RV1. DR2 is untouched —
  nothing is pre-spawned; the row exists because the user acted.

  The editor is mounted on the **board**, not inside `GhostCard`: the instant the task exists the
  ghost stops being projected and unmounts, taking any dialog rendered inside it with it.

  **Engine consequence — the spawn check narrows to today-exact.** Step 3 previously skipped a
  routine that had any instance dated **today or later**, which would let one materialized Thursday
  suppress Tuesday's and Wednesday's spawns entirely — the routine silently stops. RV6's "each day
  stands alone" has to hold in the engine, so the check is now "no row dated today". The old form
  existed to absorb a future-dated instance after a westward timezone change; that case now yields
  one extra instance on the replayed day, which is far cheaper than days of missing ones.

  **B. A missed occurrence disappears; the catch-up task is gone (supersedes RV7's phase 2).**
  Retire still flips the stale instance to `missed` with its date frozen — the record RV7 was
  built to protect is kept, and the Activity grid is unchanged. What is removed is the second row:
  no ordinary catch-up task (`fromRoutineId`) is minted any more, so a routine day you let pass
  leaves the views entirely instead of reappearing as overdue work under the same name. Owner-
  decided: a missed day of a recurring thing is a missed day, not a debt — the next occurrence is
  already coming, and the catch-up mostly produced a pile that looked like the routine had failed
  twice. With nothing minted for anyone, RV7's paused-routine special case and its
  one-outstanding-catch-up guard both fall away, and retire collapses to a single `updateMany`.

  `Task.fromRoutineId` stays in the schema — no migration. Nothing writes it now; it still carries
  the provenance of catch-ups minted before this change, and those rows are left alone (deleting
  live tasks the user may have replanned would be worse than leaving them). Triage's
  `isRoutineCatchUp` signal (TRIAGE.md §3.3) therefore still reads a real column, but on a set that
  can only shrink.

- **RV9 — History is correctable, and gaps are backfilled (2026-07-18).** Two halves that only make
  sense together, shipped in that order.

  **Phase A — correction.** Clicking an Activity cell changes what that day says: `missed` ↔ `done`,
  and a day with no row at all becomes `done`. `setRoutineDay` is deliberately looser than
  `completeOccurrence` (§RV6), which creates *future* work and so must refuse anything off-cadence:
  paused routines are allowed (pausing shouldn't freeze history) and completed-based routines are
  allowed on days that already have a row (their cadence isn't computable, so there is nothing else
  to validate a bare date against). A day with no row is only minted when the cadence covers it.
  Undo restores the exact prior state including **`clear`**, which deletes the row: undoing "I did
  do that day" on a day that had no record must leave *no record*, not a fabricated `missed` — a
  different claim than the one we started with. `clear` only ever removes a routine instance
  already carrying a verdict, never live work.

  **Phase B — backfill.** `materializeRoutines` gained a step between retire and spawn: due days
  with no row at all get a `missed` record, so the grid isn't full of `no record` holes (§RV8) and
  stats stop under-reporting. Records only — retire already minted the single catch-up task, and a
  fortnight's absence must not produce a fortnight of tasks.

  Backfill **infers** a miss it never observed, so it is bounded at both ends. `BACKFILL_EPOCH` is
  a hard floor at the ship date, not a rolling window: `Routine` stores only whether a routine is
  active *now*, with no record of when it was paused, so walking backwards would invent weeks of
  failure for routines deliberately switched off. `BACKFILL_MAX_DAYS` (30) caps the look-back so
  one long absence can't write hundreds of rows in a single page load. Completed-based routines are
  excluded — no computable grid, so no gaps to find. **Phase A shipping first is the point:** the
  fix for a wrong assertion must exist before the first one is written.

  **Known limit.** The pause hole is bounded, not closed. Pause a routine for two weeks *after* the
  epoch and backfill still writes fourteen misses on resume. Properly fixing it needs pause history
  (a `RoutineEvent` table); deferred until it actually bites.

  **Verified 2026-07-18** by temporarily lowering the epoch and driving a real materialize: exactly
  one gap was filled (the one Tuesday with no row), nothing before the epoch, nothing for today,
  nothing for a routine whose `startDate` post-dated the gap. Epoch restored and the fabricated row
  deleted afterwards. All three correction paths were driven in the browser, including
  `no record → done → undo`, which correctly deleted the row rather than leaving a `missed`.

- **RV8 — The Activity grid replaces the Completed page (2026-07-18).** RV7 phase 3. A
  contribution-style grid at `/activity`: an aggregate strip (share of each day's due routines
  completed) over per-routine rows sharing the same columns, so scanning a column reads one day
  across everything. Owner-decided to drop the global Completed page entirely; completed ordinary
  tasks stay reachable through each project view's "Show completed" toggle, at the cost of the one
  cross-project view of finished work.

  **Four cell states, not three.** `done` / `missed` / `not due` / **`no record`**. The fourth is
  the honest one and the reason this design works: materialization only runs when the app is opened
  (DR2), so any unopened day produces no rows at all. Those days are drawn *outlined* rather than
  filled — "nothing here", visually distinct from "nothing due" — because rendering them as misses
  would turn a quiet week into a week of failure. They are excluded from the completion rate, and
  they *stop* a streak rather than breaking it: an unobserved day cannot be claimed as a win.

  **Due-ness is derived, never stored.** The grid calls `occurrencesBetween` — the same function
  the spawner uses (§RV5) — so a cell and a real instance can never disagree about whether a day
  counted. Completed-based routines project nothing, so their rows show only recorded events
  against a flat background and claim no streak.

  **Reads never write.** `GET /api/routines/history` deliberately does NOT call
  `materializeRoutines`, unlike `GET /api/tasks`. Opening your history must not alter it. The
  window is clamped to 371 days. `listRoutineHistory` exists rather than reusing `listTasks`, which
  caps completed rows at 200 and drops `missed` entirely — both fatal here.

  Today renders as `not due` rather than `no record`: its instance is still open, and writing it
  off mid-morning would be a lie. The grid opens scrolled to the most recent day.

- **RV7 — A missed day is recorded, and the work becomes a replannable task (2026-07-18).**
  **Half superseded by RV10 (2026-08-02): the `missed` record stays, the catch-up task is gone.**
  Phases 1–2 BUILT (migration `routine_catch_up_tasks`); phase 3 (per-routine history view) not
  started. Reverses RV2's always-carry. Owner-decided after RV2's cost surfaced: carry
  rewrites `dueDate`, the only field recording which day an occurrence was *for*, so the per-day
  history DR1 exists to provide is destroyed for exactly the days worth recording. "Did I water the
  plants this month" is currently unanswerable.

  **Behavior.** When an unfinished instance's day has passed, it is *retired* rather than carried —
  two rows, because the record and the work are different things:
   1. **The record.** The instance is set to `missed` with its `dueDate` frozen on its own day.
      This is history and is never actionable.
   2. **The work.** A new **ordinary task** is created — same content/description/priority/project,
      `routineId` NULL, `fromRoutineId` set — dated the missed day, so it is born overdue. With no
      `routineId` it escapes RV1's date lock: draggable, reschedulable, editable, deletable like
      any task. Replanning it is the point.

  **Pile-up guard.** At most **one outstanding catch-up per routine**: if a previous catch-up for
  the routine is still active, no new one is minted. The `missed` record is still written, so
  history stays complete even when the catch-up is suppressed. Ignoring a daily routine for a week
  therefore yields 7 `missed` records but 1 task. (Owner-accepted 2026-07-18. Per-routine
  configurability — 7 skipped waterings are one watering, 7 skipped workouts may be seven — is the
  natural v2 and is essentially DR3's `onMiss` returning as a considered choice rather than a
  default.)

  **Schema.** `Task.fromRoutineId String? @db.Uuid` (+ index, `onDelete: SetNull`). A deliberately
  *soft* link: it records provenance for the guard and for stats without implying the date lock
  that `routineId` carries. Both columns must never be set on the same row. Requires a migration —
  prod migrations are manual here.

  **Consequences.** Carry disappears, and with it the collision case and RV4's tolerant carry loop
  (paused-routine parking stays — no catch-up is minted for a routine you paused on purpose).
  Ghost cards are unaffected: catch-ups have a NULL `routineId`, so they never enter the
  `routineId|dueDate` suppression set. A completed catch-up does **not** flip its `missed` record
  to completed — the day genuinely was missed, and the catch-up completion is its own record.

  **Where misses surface.** Mostly they don't need their own screen: the overdue catch-up in the
  task list *is* the visible consequence. The `missed` records are history and belong on the
  Routines page as a per-routine view. Explicitly **no Today recap strip** — it was removed once
  already (RV2) and this design makes it redundant rather than merely empty.

  **Applies going forward only.** Instances already carried under RV2 have overwritten dates; that
  history is unrecoverable (owner-accepted 2026-07-18).

  **Phases.** (1) schema + migration; (2) retire logic in `materializeRoutines`, replacing carry;
  (3) per-routine history on the Routines page. Phase 2 is the behavior change and is independently
  shippable — phase 3 only adds a view over data phase 2 already writes.

  **Verified 2026-07-18** against the dev DB by backdating an instance and driving a real
  materialize: the instance flipped to `missed` with its date frozen, one catch-up appeared dated
  the missed day with `routineId` NULL, and its edit dialog offers an editable date picker (a
  routine instance's is read-only under RV1). Backdating a second instance while that catch-up was
  still active wrote the `missed` record but minted no second task — the guard holds. NOT yet
  verified: several routines retiring in one pass, and dragging a catch-up on the Upcoming board.

- **RV6 — A ghost can be completed ahead of time (2026-07-18).** RV5 shipped ghosts as fully inert;
  the owner asked for "I did Thursday's routine today". Clicking a ghost's circle calls
  `completeOccurrence` (`src/lib/data/routines.ts`), which creates that occurrence's row **on its
  own date, already completed** — `dueDate` is the day it was *for*, `completedAt` is when it was
  confirmed, exactly the split RV3 established. DR2's today-only spawn is untouched: the row exists
  because the user acted, not because anything was pre-spawned, and the spawn step's
  "instance dated today-or-later in any status" check means the day itself won't duplicate it.
  Guarded server-side (a server action takes any arguments): routine must be the caller's and
  active, the date must be a real occurrence on the cadence, and it must not be in the past —
  backdating would fabricate the per-day history DR1 exists to keep honest. Completed-based
  routines are rejected outright, matching `occurrencesBetween` projecting none for them.
  Idempotent via the `(routineId, dueDate)` unique + `skipDuplicates`, which also means an existing
  row is never overwritten — a stray call cannot silently complete today's active instance.
  **Each day stands alone:** completing Thursday ahead does not satisfy Tue/Wed, which still
  materialize normally. Ghosts remain non-draggable and non-editable (RV1).

- **RV5 — Upcoming previews routines as projections, not rows (2026-07-18).** The Upcoming board
  drew seven day-columns but routines only ever appeared in today's, because DR2 materializes one
  instance per day on read. Rather than pre-spawning a week of real `Task` rows, the board computes
  the occurrences itself via `occurrencesBetween` (`src/lib/repeat.ts`) and renders dashed, inert
  **ghost cards** for any date without a real instance. No schema change, no migration, no API
  change — `repeat.ts` was already shared server/client by design and `useRoutines` already fetches
  the templates. Pre-spawning was rejected because it breaks the RV2/RV4 carry rule (tomorrow's row
  would always exist, so every unfinished instance would hit the collision path), lets the user
  complete Friday's routine on Monday, and makes a template edit invisible until the pre-spawned
  window drains. Projections instead correct themselves the moment the template changes.
  Completed-based routines project nothing: their next date depends on when the current one is
  ticked, so any projection would visibly retract itself. Ghost cards are not completable or
  draggable — there is no row to act on, and RV1 already locks instance dates.

- **RV4 — A carry that cannot land leaves the instance overdue; it is never parked (2026-07-18).**
  RV2 left two producers of `status = 'missed'`: paused-routine leftovers, and *collisions* (an
  instance dated today-or-later already exists, so the stale one cannot take today's slot). But
  `listTasks` never returns `missed` rows and **no view renders them** — the recap strip that used
  to surface them was removed in RV2. Parking on collision therefore destroyed unfinished work
  silently and irreversibly from the UI. Collisions now leave the instance **active on its own
  date**, where Today's Overdue section and the Upcoming board's Overdue column both already show
  it. Paused-routine parking stays (it is reversible by unpausing) and is now the only producer.
  Two related hardenings in the same change: the carry writes row-by-row inside a `try`, because a
  concurrent `/api/tasks` materialize can create today's instance first and make the
  `(routineId, dueDate)` unique reject the move — previously that threw out of a batched
  `updateMany` and **aborted the spawn step**, so *every* routine silently went missing for that
  read. A lost race is now a no-op that leaves the row overdue. Note this is deliberately not
  solved with a transaction: at Postgres' default read-committed isolation both writers can still
  observe "no row for today", so only `SERIALIZABLE` + retry would close it — too costly for every
  tasks read, and unnecessary once losing the race is harmless.

- **RV3 — "Done yesterday but forgot to check it off"** is now simply completing the carried
  instance: `completedAt` records when it was confirmed. No backfill flow needed; the planned R3
  `backfill_missed` agent tool is dropped.

## 2. Product requirements

### Goals

1. Create/edit/pause/delete daily routines (UI + chat agent).
2. Each local day, an instance of every active routine appears in **Today** automatically.
3. Missed days are recorded, recoverable (one-tap backfill for yesterday; agent-driven for older),
   and never pile up as overdue clutter.
4. The chat agent can manage routines and reason over miss history.

### Non-goals (this feature's v1)

- **RRULE / non-daily schedules** ("every Mon/Wed", "every 2 weeks"). `schedule` is the literal
  string `'daily'`; the column exists so RRULE can land later without a migration.
- Cron, push notifications, digests (see DR2).
- Streak/stats UI (agent can compute from data; a widget is v2).
- Sub-day recurrence ("every 4 hours").

### Behavior spec

- **Spawn:** on the first tasks read of a new local day, each active routine gets one instance:
  `Task { routineId, dueDate = local today, content, description, priority, projectId }` copied from
  the template.
- **Sweep (same moment):** stale active instances (`due_date < today`) → `missed` for `onMiss='skip'`
  routines; → rescheduled to today for `onMiss='carry'` routines (no duplicate spawn).
- Completing an instance is normal task completion; nothing recurrence-related happens at completion
  time. Completing yesterday's instance *before* the sweep runs is allowed and is a normal completion.
- The sweep only ever flips `active → missed`; it never touches `completed`.
- **Backfill:** a `missed` instance can be completed after the fact (status → `completed`,
  `completedAt = now()`, `dueDate` unchanged).
- **Template vs instance edits:** editing a routine affects *future* instances only (today's
  already-spawned instance keeps its values). Editing one instance (any normal task edit) never
  touches the template.
- **Instances keep their date (decided 2026-07-14).** Each instance stands for a specific day —
  that's the point of a routine — so rescheduling is blocked at the data layer (`updateTask`
  rejects a changed `dueDate` on a `routineId` task; `bulkReschedule` skips them with reason
  `routine_date_fixed`, which also covers the chat agent's tools). The UI mirrors this: the edit
  dialog shows the date read-only and board cards with a `routineId` aren't draggable. Same-date
  writes still pass so board reorders work. The spawner's "an instance dated today **or later**
  exists" check remains as a safety net (e.g. a westward timezone change can leave a
  future-dated instance; without the check it would duplicate). If you didn't do a day, the
  answer is `missed` + backfill, not a date change.
- **Pause** (`active = false`): no new instances; history remains; resumable.
- **Delete routine:** completed/missed instances survive as history (`routineId` set NULL via
  `onDelete: SetNull`); today's still-active instance is deleted with it.
- **Today view recap:** if yesterday has `missed` instances, show a one-line strip
  ("Yesterday: 2 missed — done any of these?") with one-tap confirm (backfill). Older misses are the
  agent's job, not the UI's.

### Acceptance

- Create a routine → open Today → instance is there; complete it → it shows in Completed; next local
  day → fresh instance, yesterday's stays completed.
- Leave an instance incomplete overnight → next load it is `missed`, absent from Today/overdue; the
  recap strip offers it; tapping confirm makes it `completed` with original `dueDate`.
- A `carry` routine left incomplete → next load shows *one* instance dated today (no duplicate).
- Two concurrent first-loads of the day create exactly one instance per routine (unique constraint).
- Pause → no instance next day; resume → instance the day after resume. Delete → history retained.
- Chat: "add a daily routine to stretch every morning", "pause my reading routine",
  "which routines did I miss this week?", "I actually did stretch yesterday" all work.

## 3. Technical design

### 3.1 Schema (Prisma, `prisma/schema.prisma`)

```prisma
model Routine {
  id          String   @id @default(uuid()) @db.Uuid
  userId      String   @map("user_id") @db.Uuid
  projectId   String   @map("project_id") @db.Uuid
  content     String
  description String?
  priority    Int      @default(4) @db.SmallInt
  schedule    String   @default("daily") /// v1: literal 'daily' only; RRULE later
  onMiss      String   @default("skip") @map("on_miss") /// 'skip' | 'carry'
  active      Boolean  @default(true)
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  user    Profile @relation(fields: [userId], references: [id])
  project Project @relation(fields: [projectId], references: [id])
  tasks   Task[]

  @@index([userId, active])
  @@map("routines")
}
```

`Task` gains:

```prisma
  routineId String?  @map("routine_id") @db.Uuid
  routine   Routine? @relation(fields: [routineId], references: [id], onDelete: SetNull)

  @@unique([routineId, dueDate]) // idempotency guard; Postgres treats NULLs as distinct,
                                 // so ordinary tasks (routineId NULL) never collide
```

`Task.status` (already a plain `String`) gains the app-level value `'missed'` alongside
`'active' | 'completed'` — no migration needed beyond the comment. `Profile` and `Project` gain the
back-relation `routines Routine[]`. If Neon RLS policies exist for `tasks`, mirror them onto
`routines`.

### 3.2 Materialization (`src/lib/data/routines.ts`)

The entire recurrence engine is one idempotent, user-scoped function — the only place in the codebase
that knows recurrence exists:

```
materializeRoutines(userId, today /* todayStr(profile.timezone) */):
  1. SWEEP (skip):  task.updateMany
       where { userId, status: 'active', dueDate < today, routine: { onMiss: 'skip' } }
       set   { status: 'missed' }
  2. CARRY:         for carry routines with a stale active instance and NO instance dated today,
       reschedule the stale instance's dueDate → today (ordered before spawn so the
       (routineId, dueDate) unique can't collide; if today's instance somehow already
       exists, fall back to sweeping the stale one)
  3. SPAWN:         active routines with no instance dated today →
       task.createMany({ data: [...template copies], skipDuplicates: true })
```

Failures from concurrent races are absorbed by `skipDuplicates` + the unique index — no locking, no
transaction requirements beyond per-statement atomicity.

**Wiring point:** `GET /api/tasks` (`src/app/api/tasks/route.ts`) — the single fetch behind the
`['tasks']` TanStack Query that every view reads. Resolve the profile once for `timezone`, call
`materializeRoutines(user.id, todayStr(tz))`, then `listTasks(user.id)` as today. Cost when nothing
to do: one cheap indexed read.

### 3.3 Read path & DTO

`listTasks` already queries `status: 'active'` and `status: 'completed'` separately, so `missed`
rows are **invisible to all existing views with zero changes** — the pile-up prevention falls out of
the current code. Additions:

- `TaskDTO.status` union gains `'missed'`; `toDTO` passes it through (today it coerces unknown →
  `'active'`, which would wrongly resurrect missed tasks — must fix in the same change).
- `TaskDTO` gains `routineId: string | null` (drives the repeat badge).
- `listTasks` adds a third bounded query: `missed` instances with `dueDate >= today - 2` (feeds the
  recap strip). Client bucketing (`use-tasks.ts` / views) must route `missed` **only** to the recap
  strip — never Today/overdue/board buckets.
- Backfill = existing complete path from status `missed` (verify `setTaskStatus` doesn't assume the
  prior status was `active`).

### 3.4 Routine CRUD surface

`src/lib/data/routines.ts` (list/create/update/delete, all user-scoped, `projectId` ownership checked
via `userOwnsProject` like tasks) + `src/app/actions/routines.ts` server actions mirroring
`actions/tasks.ts` conventions (auth via session, revalidate/invalidate `['tasks']` and a new
`['routines']` query).

### 3.5 Agent tools (`src/lib/ai/tools.ts`)

New zod-typed, user-scoped tools following the existing `buildTools` pattern and fan-out guard:

- `list_routines` — templates + per-routine recent history (last 7 days: done/missed/no-show).
- `create_routine`, `update_routine` (edit fields, pause/resume, `onMiss`), `delete_routine`.
- `backfill_missed(taskIds)` — `missed → completed` (bulk; powers "I actually did X yesterday").

Review skill (TDD §6.3): include miss-streak context ("'read 20 pages' missed 5 of last 7 days") so
the end-of-day review can propose shrinking/rescheduling/pausing a struggling routine.

## 4. Build phases

Same protocol as [PROMPTS.md](./PROMPTS.md): feed one phase at a time; "Done when" is the exit
criteria; each phase ends runnable.

---

### Phase R1 — Schema + materialization engine (no UI)

**Goal:** routines exist in the DB and instances spawn/sweep correctly on read.

**Prompt:**
> Read `docs/ROUTINES.md` §3. Add the `Routine` model and the `Task` changes (`routineId` +
> `@@unique([routineId, dueDate])`, `onDelete: SetNull`) to `prisma/schema.prisma` exactly as spec'd;
> run `prisma migrate dev`. Implement `src/lib/data/routines.ts`: user-scoped CRUD
> (`listRoutines`, `createRoutine`, `updateRoutine`, `deleteRoutine` — ownership checks like
> `lib/data/tasks.ts`) and `materializeRoutines(userId, today)` implementing sweep→carry→spawn per
> §3.2 (idempotent; `skipDuplicates`). Wire it into `GET /api/tasks` before `listTasks`, using
> `todayStr(profile.timezone)`. Update `listTasks`/`toDTO`/`TaskDTO` per §3.3 (`'missed'` status
> passes through — do NOT let the current coercion resurrect missed rows as active; add `routineId`;
> add the bounded missed query). Add `src/app/actions/routines.ts` server actions. No UI yet.

**Done when:** with a routine created via a seed script or server action: first `GET /api/tasks` of
the day inserts exactly one instance (verify double-fire inserts nothing); manually backdating an
active instance then re-fetching flips it to `missed` (skip) or reschedules it to today (carry);
completing a `missed` task via the existing action yields `completed` with original `dueDate`;
existing views still render and never show `missed` rows; `npm run build` and lint pass.

---

### Phase R2 — Routines UI

**Goal:** manage routines and recover misses without the chat.

**Prompt:**
> Read `docs/ROUTINES.md` §2. Build a **Routines** management page (app shell nav alongside
> Settings) listing routines with create/edit dialogs (content, description, priority, project,
> `onMiss`), pause/resume toggle, and delete (confirm; explain history is kept). Reuse existing
> shadcn/ui patterns and the task-editor conventions. Add a small repeat icon (lucide `Repeat`) on
> task cards where `routineId != null`. In the Today view, when yesterday has `missed` instances,
> render a one-line recap strip — "Yesterday: N missed" with per-item one-tap confirm that calls the
> complete action (backfill) — hidden when empty; it must not occupy Today's task list ordering.
> Invalidate `['tasks']`/`['routines']` after mutations, optimistic updates per `use-tasks.ts`
> conventions.

**Done when:** create → instance appears in Today after refetch with repeat badge; pause/resume and
delete behave per acceptance; leaving an instance overnight (or backdating in dev) surfaces the recap
strip and one-tap confirm moves it to Completed; strip absent when no misses; responsive layout holds.

---

### Phase R3 — Agent integration

**Goal:** the chat can manage routines and reason over miss history; review knows about routines.

**Prompt:**
> Read `docs/ROUTINES.md` §3.5. In `src/lib/ai/tools.ts` `buildTools`, add `list_routines`
> (templates + last-7-day per-routine history: completed/missed/no-instance), `create_routine`,
> `update_routine`, `delete_routine`, `backfill_missed` — zod-typed, user-scoped, respecting the
> existing fan-out guard and result-shape conventions. Update the system prompt so the model knows
> routines exist, that "I did X yesterday" means backfill (not creating a new task), and that
> routine instances are normal tasks it can already complete/edit. Extend the review skill context
> (TDD §6.3) with miss streaks so end-of-day review can propose shrinking, rescheduling, or pausing
> a struggling routine (proposal only — applies via existing confirm flow).

**Done when:** the acceptance-chat utterances in §2 work end-to-end against a real thread; the
review flow mentions a routine missed ≥3 of the last 7 days and its proposal applies cleanly; tool
calls are rate-limited/fan-out-guarded like existing tools.

---

## 4.1 Custom repeat (implemented 2026-07-14)

Replace the fixed daily cadence with a Things-style custom repeat. Controls: **Based on**
(scheduled date | completed date), **Every** N days (unit column ready for week/month later),
**Ends** (never | on date, inclusive).

- **Scheduled-based:** occurrences on a fixed grid `startDate + k·N` regardless of completion
  timing; `startDate` anchors the grid and defaults to the creation day (user tz). Late
  completion does not shift the grid.
- **Completed-based:** next due = local calendar day of `completedAt` (profile tz) + N; first
  occurrence on `startDate`.
- **Composition with RV1/RV2:** carry unchanged — an unfinished instance follows the user daily
  between occurrences, and if still active at the next occurrence it *is* that occurrence (the
  `(routineId, dueDate)` guard merges them, Todoist-style single overdue). "Ends" stops new
  spawns only; a leftover keeps carrying until done or deleted.
- **Schema (one migration, replaces `schedule`):** `repeatEvery Int @default(1)`,
  `repeatUnit String @default("day")`, `repeatBase String @default("scheduled")`,
  `startDate @db.Date` (set app-side at creation), `endDate @db.Date?` (inclusive).
  Existing routines map to every-1-day/scheduled/never — behavior identical.
- **Engine:** spawner gains per-routine "due today?" (`(today−startDate) % N === 0` resp.
  `today ≥ lastCompletionLocal + N`); needs profile tz passed in for completion-day math.
- **Phases:** CR1 schema + engine + data layer + test-suite extension (cadence grid,
  completed-shift, end date, carry across gaps); CR2 dialog Repeat block + routines-page cadence
  summary ("Every 3 days · after completion · until Aug 1") + browser verify.
- **Deferred:** time-of-day.

## 4.2 Repeat units (implemented 2026-07-16, CR3)

The `Every` row gains a unit dropdown — **Day | Week | Weekday | Month | Year** — and, for a
scheduled-based `Week`, an **On** row of weekday checkboxes (Todoist-style). All cadence rules live
in `src/lib/repeat.ts` (pure, over 'YYYY-MM-DD' strings) and are shared by the engine and dialog;
`materializeRoutines` just asks `isDueOn(routine, today, lastCompletionDay)`.

- **Schema:** one column, `repeatWeekdays Int[] @default([])` (0=Sun … 6=Sat), migration
  `routine_repeat_units`. `repeatUnit` already existed. Existing rows are every-1-day/scheduled —
  unchanged.
- **Scheduled-based rules:** `day` = `(today−startDate) % N === 0`. `week` = weeks counted from the
  **Sunday of the anchor's week** (so the anchor week is week 0), `% N === 0`, and today's weekday is
  ticked. `weekday` = any Mon-Fri. `month` = `monthsBetween % N === 0` and day-of-month matches the
  anchor's, **clamped** to the month's last day. `year` = same, plus month match.
- **Completed-based rules:** next due = last completion's local day + N units (`week` = N×7 days;
  `month`/`year` clamp the same way). No completion yet → due from `startDate`.
- **Owner decisions (2026-07-16):**
  - **Weekday pins N to 1** (Todoist-style "every weekday" = Mon-Fri). The number box disables when
    the unit is Weekday; `MAX_EVERY` encodes it alongside the other per-unit bounds.
  - **Month-end clamps, never skips** (Jan 31 → Feb 28/29, Apr 30). Things/Reminders behavior: a
    monthly routine never silently vanishes for a month. Feb 29 yearly → Feb 28 in common years, so
    there is always exactly one occurrence per period.
  - **Completed-based hides the On row.** "N weeks after I finish it" contradicts a weekday list, so
    weekdays are cleared on write rather than half-honored.
- **Canonical writes:** `normalizeRepeat` runs on every create/update (and will cover the R3 agent
  tools), so stored rows never carry irrelevant fields — the engine never has to second-guess them.
  An empty weekday list falls back to the anchor's own weekday.
- **Deferred:** month "on the Nth weekday" (e.g. 3rd Tuesday), day-of-month picker independent of
  the anchor, time-of-day.

## 5. Deferred (v2 candidates)

- Non-daily schedules (`schedule` → RRULE subset) — column already exists.
- Vercel Cron + notifications/digest for proactive agent outreach (reuses `materializeRoutines`).
- Streak/consistency widget (data already queryable).
- Distinguish "confirming I did it" vs "retroactively forgiving myself" in backfill stats.

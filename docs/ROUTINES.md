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
- **Rescheduling an instance to a future day = postpone.** The spawner treats "an instance dated
  today **or later** exists" as satisfied, so nothing regenerates for today (or the gap days) and
  the moved instance is that future day's instance. Daily spawning resumes the day after it.
  (Without this, moving today's instance forward would immediately regenerate today's — a
  duplicate.) Moving an instance to a *past* day just gets it swept to `missed` on the next load.
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

## 5. Deferred (v2 candidates)

- Non-daily schedules (`schedule` → RRULE subset) — column already exists.
- Vercel Cron + notifications/digest for proactive agent outreach (reuses `materializeRoutines`).
- Streak/consistency widget (data already queryable).
- Distinguish "confirming I did it" vs "retroactively forgiving myself" in backfill stats.

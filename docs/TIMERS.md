# Task timers — Feature Spec & Build Plan

**Owner:** Guoxuan Xu
**Status:** Draft v1
**Last updated:** 2026-11-01
Companion docs: [ESTIMATES.md](./ESTIMATES.md) · [ESTIMATE-VS-ACTUAL.md](./ESTIMATE-VS-ACTUAL.md) ·
[CAPACITY.md](./CAPACITY.md) · [ROUTINES.md](./ROUTINES.md)

---

## 1. Summary

A start/stop button on each task card. Start records when work began; stop records when it ended
and adds the session to the task's `timeUsed`. While a timer runs, the card counts up against the
estimate, and a pill in the app header shows the running task from every view.

This is the "Timers" item ESTIMATES.md §5 deferred: "start/stop that writes `timeUsed`, removing
the last manual duration entry."

### Why now: the evidence

Of the last 200 completed tasks (MCP `list_tasks`, 2026-11-01):

| | Count |
|---|---|
| Have an estimate | 112 |
| Have `timeUsed` | 29 |
| …of those, logged in the week of Oct 19 | 19 |
| …of those, a multiple of 15 minutes | 20 |
| …of those, exactly equal to the estimate | 6 |

Manual logging was tried for one week and dropped. What survives is mostly recalled, rounded
guesses. The Estimate-vs-actual page and the capacity bar's "done" segment (CAPACITY DC3) both read
`timeUsed`, so both currently run on thin, approximate data.

**Thesis:** the missing piece is not a field (`timeUsed` exists) but the cost of producing the
number. Recall after the fact is effort, and it is skipped. Two clicks at the moment of work cost
almost nothing and produce an exact number.

### Decisions

- **DT1 — The server stores a timestamp; the browser does the counting.** Start writes one row with
  `startedAt`; stop writes `endedAt`. Nothing runs between the two: no process, no socket, no cron.
  A running timer is a row with no end, so it costs nothing while the Vercel function and the Neon
  compute are scaled to zero. The card computes `now − startedAt` once a second locally, which is
  also why the timer survives a closed tab, a reload, or a switch to another device. Each session
  costs two writes, the same as editing a task twice.

- **DT2 — Sessions are rows; `timeUsed` stays the task's total.** A `TimeEntry` table holds each
  session's start and end, and stopping adds the session's minutes to `Task.timeUsed` in the same
  transaction. Every existing reader of `timeUsed` (Estimate-vs-actual, the capacity bar, the done
  chips, MCP `list_tasks`, export) keeps working unchanged. Sessions are kept rather than only a
  running total because they record *when* the work happened, which a future day timeline or
  review can use, and because a task often takes several sittings.

  `timeUsed` remains the number the user stands behind: editing it in the task dialog overrides the
  total and does not touch the sessions. The sum of sessions is therefore *not* an invariant, and
  no code may recompute `timeUsed` from them.

- **DT3 — One running timer per user, enforced by the database.** A partial unique index on
  `time_entries (user_id) WHERE ended_at IS NULL`. Starting a timer while another runs stops the
  first one in the same transaction, so switching tasks is one click.

- **DT4 — Forgotten timers are caught at stop time, not in the background.** A background check
  would need a scheduled job, which the free plan can't run often enough to matter. Instead, when a
  stop would record more than **3 hours**, or a session that crossed the user's local midnight, the
  stop opens a short prompt: keep the full time, enter when work actually stopped, or discard the
  session. The 3-hour threshold is owner-confirmed (2026-11-01): long enough not to interrupt real
  long sessions (logged times reach 10h), with midnight catching the overnight case regardless.

- **DT5 — Completing a task stops its timer.** Done in the data layer (`setTaskStatus`,
  `bulkComplete`), not the UI, so completion from an MCP client stops it too.
  Deleting a task deletes its sessions, including a running one.

- **DT6 — Session minutes are rounded to the nearest minute; under one minute is discarded.** A
  sub-minute session is a misclick, and recording `0` would make an untimed task look timed
  (Estimate-vs-actual treats any positive `timeUsed` as timed, EA3). A stop that would push
  `timeUsed` past its 5999-minute bound (ESTIMATES DE3) is clamped to it.

- **DT7 — The server sets timestamps; the client corrects for its own clock.** `startedAt` is
  `now()` on the server, so a wrong device clock can't corrupt the record. Every timer response
  carries the server's `now`, and the client keeps the offset so the displayed elapsed time is
  right even on a device whose clock is off.

- **DT8 — No timers on routines (owner-decided 2026-11-01).** A routine's card has no task row
  behind it until it is ticked, and ROUTINES stores no pending rows, so a timer would have nothing
  to attach to. Routine cards get no button, and a recorded routine day (`routineId` set) is
  refused by `startTimer`. A routine's `timeUsed` stays manual.

- **DT9 — Timers appear wherever a task row does.** The Upcoming board's cards and the `task-row`
  lists (Inbox and project views) share one button, so a task can be timed from wherever it is
  found. A list row has no card border, so running tints the row instead.

---

## 2. Product requirements

### Goals

- Start and stop timing a task from its card on the Upcoming board in one click each.
- See at a glance which task is running, for how long, and how that compares to its estimate.
- Never lose a running timer to a closed tab, a reload, or a switch between laptop and phone.
- Recover cleanly from a timer left running overnight.

### Non-goals (v1)

- **Pause/resume.** Stop and start again creates a second session, which is the same thing.
- **Pomodoro, focus mode, or idle detection.** Idle detection needs a desktop app watching the
  keyboard; a web app can't see it.
- **Server-side auto-stop, push notifications, or live sync between open tabs.** Each needs
  something running in the background (DT1). A second tab catches up when it regains focus.
- **A list or editor of individual sessions.** The `timeUsed` field in the task dialog remains the
  correction path.
- **A day timeline built from sessions.** DT2 makes it possible; it is a separate feature.
- **Timers on routines** (DT8).
- **MCP timer tools.** Tracked in [issue #62](https://github.com/g7xu/agentic-todo/issues/62),
  after the in-app timers have been used for a while.

### Behavior spec

**Idle card.** A play button sits beside the `⋯` options button, hidden until hover on desktop like
that button is, always visible on touch. Completed cards, temporary (optimistic) cards and routine
cards (DT8) have none. List rows behave the same way (DT9).

**Running card.**

```
┌──────────────────────────────────────────┐
│ ○  Job application: Anthropic        ■   │   accent border, stop button
│    ● 18:42 of 30m                         │   live elapsed vs estimate
│    ▬▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░                 │   progress toward the estimate
└──────────────────────────────────────────┘
```

- Elapsed shows `m:ss` under an hour, `h:mm:ss` from an hour, tabular figures so it doesn't jitter.
- With an estimate: `of 30m` and a thin bar. Past the estimate the border, text and the overrun part
  of the bar turn amber. Without an estimate: elapsed alone, no bar.
- Previously recorded time is included: a task with 20m logged that has run 10m more shows `30:00`.

**Header pill.** While any timer runs, the header shows `● <task title> 18:42 ■`, the title
truncated, with its own stop button. The title is not a link in v1. The pill is the only timer UI
on views that don't show the task.

**Tab title.** While running: `18:42 · <task title>`; restored on stop.

**Starting another.** Clicking play on task B while A runs stops A (A's card shows its new
`timeUsed`) and starts B. No confirmation.

**Stopping.** Adds the session to `timeUsed`; the ⌛ chip updates. Under a minute: nothing is
recorded and the card simply returns to idle.

**Long-run prompt (DT4).** `Timer ran 9h 12m. When did you actually stop?` with **Keep 9h 12m**,
a time field (**Stopped at …**, defaulting to the start time plus the task's estimate, or 1 hour),
and **Discard**. Dismissing the prompt leaves the timer running.

**Completing.** Ticking a running task stops it first (DT5), with no long-run prompt: completion
is the moment the user says the work ended. In the app, a timer past the DT4 threshold is the one
exception: the prompt shows before completing. An MCP completion has no UI and records the full
session.

**Other devices.** Opening the app, or returning to its tab, re-reads the running timer, so a
timer started on the phone shows on the laptop and can be stopped there.

### Acceptance

- Start on a card, reload the page: the card is still running with the right elapsed time.
- Start on the laptop, open the app on the phone: the phone shows the same timer and can stop it.
- Start A, then start B: A stops with its time recorded; only B runs.
- Two browser tabs racing to start different tasks leave exactly one running timer.
- Stop after 12m on a task with 20m logged: `timeUsed` reads 32m.
- Stop after 20 seconds: `timeUsed` is unchanged and still `null` if it was.
- A timer started at 11pm and stopped at 9am the next day opens the long-run prompt; **Stopped
  at 11:40 PM** records 40m.
- Completing a running task from the MCP `complete_task` tool stops it and records the session.
- Deleting a running task leaves no running timer behind.
- The header pill and tab title appear on Inbox, Activity and Settings while a timer runs.
- Account export includes every session; account delete removes them.

---

## 3. Technical design

### 3.1 Schema

```prisma
/// One stretch of work on a task (docs/TIMERS.md). `endedAt` null = running;
/// at most one per user (partial unique index, raw SQL in the migration).
model TimeEntry {
  id        String    @id @default(uuid()) @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  taskId    String    @map("task_id") @db.Uuid
  startedAt DateTime  @map("started_at") @db.Timestamptz(6)
  endedAt   DateTime? @map("ended_at") @db.Timestamptz(6)

  user Profile @relation(fields: [userId], references: [id])
  task Task    @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@index([taskId])
  @@index([userId, startedAt])
  @@map("time_entries")
}
```

Migration `add_time_entries` adds the table and, as raw SQL like the one-Inbox index:

```sql
CREATE UNIQUE INDEX time_entries_one_running_per_user
  ON time_entries (user_id) WHERE ended_at IS NULL;
ALTER TABLE time_entries ADD CONSTRAINT time_entries_end_after_start
  CHECK (ended_at IS NULL OR ended_at >= started_at);
```

### 3.2 Pure helpers (`src/lib/timer.ts`)

```ts
sessionMinutes(startedAt: Date, endedAt: Date): number   // rounded; 0 when < 1 minute (DT6)
formatElapsed(seconds: number): string                   // "18:42", "1:22:05"
needsStopReview(startedAt: Date, now: Date, tz: string): boolean  // > 3h or crossed local midnight
LONG_RUN_MINUTES = 180
```

Unit-tested directly, like `capacity.ts` and `estimate-accuracy.ts`.

### 3.3 Data layer (`src/lib/data/timers.ts`)

| Function | Does |
|---|---|
| `getRunningTimer(userId)` | the open entry with its task's id, title, estimate and `timeUsed`, or null |
| `startTimer(userId, taskId)` | in one transaction: stop any open entry (via `closeEntry`), insert the new one. Refuses a task that isn't the user's, isn't `active`, or is a routine day (DT8) |
| `stopTimer(userId, endedAt?)` | closes the open entry at `endedAt ?? now()`; `endedAt` must be after `startedAt` and not in the future |
| `discardTimer(userId)` | deletes the open entry |
| `closeEntry(tx, entry, endedAt)` | the one place that writes `endedAt` and adds `sessionMinutes` to `timeUsed`, clamped to 5999; deletes the entry instead when it rounds to 0 |
| `stopTimerOnTasks(userId, taskIds)` | closes the open entry if it is on one of `taskIds`; one read and no transaction when it isn't |

The writers resolve to the affected task's id, not a `TaskDTO`: `tasks.ts` imports this module for
its completion paths, so importing back from it would be a cycle. The actions in §3.4 read the DTO.

A start racing another start fails the partial unique index with P2002; `startTimer` retries once,
which stops the winner's entry and takes over — last click wins. Both racers can also read the
same entry and try to close it; `closeEntry` only writes while the entry is still open, so the
second close matches nothing and a session is never added to `timeUsed` twice.

`setTaskStatus` (to `completed`) and `bulkComplete` call `stopTimerOnTasks` just before their
completion write. It is not the same transaction: `bulkComplete` batches its writes as an array,
which can't hold the read-then-write a stop needs. Stopping first means a failure in between leaves
a stopped timer on a still-open task, which the user can simply complete again.

`deleteAccount` deletes `timeEntry` rows before `task` rows; `exportAccount` adds `timeEntries: { taskId, startedAt, endedAt }[]` (additive, so the
export `version` stays 1).

### 3.4 Transport

- `GET /api/timer` → `{ timer: RunningTimerDTO | null, now: string }`. Separate from
  `GET /api/tasks` on purpose: that route records missed routine days on every read and is too
  heavy to refetch on every focus.
- Server actions in `src/app/actions/timers.ts`: `startTimerAction(taskId)`,
  `stopTimerAction(endedAt?)`, `discardTimerAction()`, each returning the same shape plus
  `changed`, the `TaskDTO` whose `timeUsed` moved, so the client can patch `['tasks']` without a
  refetch.

### 3.5 Client

- `src/hooks/use-timer.ts`: query `['tasks', 'timer']` with `refetchOnWindowFocus: "always"` (the
  app default is `false`, `providers.tsx`) — this is the whole cross-device mechanism. Keying it
  under `['tasks']` means every task write's invalidation re-reads it, which is how completing or
  deleting the running task clears the timer without `useCompleteTask` knowing about timers.
  Mutations `useStartTimer` / `useStopTimer` / `useDiscardTimer` update the timer optimistically
  and patch `changed` into `['tasks']` from the response.
- `useElapsed(startedAt, offsetMs)`: a 1-second interval, mounted only by the running card, the
  header pill and the tab-title effect, so idle boards render no timers.
- `src/components/timer-button.tsx`: the play/stop button, shared by the board's `TaskCard` and
  `task-row.tsx` (DT9).
- `src/components/running-timer.tsx`: the header pill and the tab-title effect, mounted in
  `AppShell`.
- `src/components/stop-review-dialog.tsx`: the DT4 prompt.

---

## 4. Build phases

Each phase ends runnable, with `npm test`, `npm run lint` and `npm run build` green.

### Phase T1 — data layer

> **Prompt:** Add `TimeEntry` per §3.1 and migrate as `add_time_entries`, including the raw-SQL
> partial unique index and check constraint. Write `src/lib/timer.ts` (§3.2) and
> `src/lib/data/timers.ts` (§3.3) with tests in the in-memory-Prisma style of
> `src/lib/data/tasks.test.ts`. Hook `closeEntry` into `setTaskStatus` and `bulkComplete`; add
> time entries to `deleteAccount` and `exportAccount`.

**Done when:** tests cover start-stops-previous, the sub-minute discard, the 5999 clamp, completion
stopping a timer, and a stop time before the start being refused.

### Phase T2 — transport and hooks

> **Prompt:** Add `GET /api/timer` and `src/app/actions/timers.ts` per §3.4, zod-validated and
> scoped by `requireUser()`. Add `src/hooks/use-timer.ts` and `useElapsed` per §3.5.

**Done when:** a timer started through the action survives a reload and reads back with the right
elapsed time; nothing is rendered yet.

### Phase T3 — the board

> **Prompt:** Build `timer-button.tsx` and add it to `TaskCard` in `views/upcoming-board.tsx`, with
> the running-card treatment from §2. Add `running-timer.tsx` (header pill and tab title) to
> `AppShell`, and `stop-review-dialog.tsx`.

**Done when:** every acceptance bullet in §2 passes, checked in the browser through the auth
harness at 375px and desktop width, in both color schemes.

### Phase T4 — list rows

> **Prompt:** Add `TimerButton` and the running treatment to `task-row.tsx`, so Inbox and project
> lists can start and stop timers (DT9).

**Done when:** a timer started in Inbox shows as running on the board, and the reverse.


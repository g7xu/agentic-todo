# Task estimates (and a duration control that isn't awkward) — Feature Spec & Build Plan

**Owner:** Guoxuan Xu
**Status:** Draft v1
**Last updated:** 2026-07-26
Companion docs: [PRD.md](./design/PRD.md) · [TDD.md](./design/TDD.md) · [PROMPTS.md](./design/PROMPTS.md) · [DECISIONS.md](./design/DECISIONS.md) · [ROUTINES.md](./ROUTINES.md)

---

## 1. Summary

Add an **estimate** to tasks and routines — how long the work is expected to take — entered at
creation time from the quick-add composer, and rolled up into a per-day total so a day's load is
visible before committing to it.

Along the way, replace the duration *entry* method. Today the only duration field is `timeUsed`
(minutes actually spent, migration `20260712211311_add_task_time_used`), entered as a free-text
input that demands a strict `HH:MM` string. Typing `30`, `1.5h`, or `90m` all fail into an
`aria-invalid` border with no explanation. One forgiving control now serves both fields.

`estimate` and `timeUsed` are deliberately separate: expected vs. actual. Keeping both is what makes
"you thought 30m, it took 2h" answerable later.

### Decisions (owner-decided 2026-07-26)

- **DE1 — Preset chips + a forgiving parser**, not a stepper, slider, or masked `HH:MM` box.
  Durations cluster hard around a handful of values, so six presets cover most entries in one click;
  everything else is typed into a free-text field that accepts `30`, `30m`, `2h`, `1h30`, `1.5h`,
  and `1:30`. This is the shape [Todoist][td], Jira/Tempo, and the Vaadin/Telerik duration pickers
  all converge on, and it was the shape of the Date chip in `quick-add.tsx` when this was decided —
  presets in a `DropdownMenu` with a raw input below a separator and an `X` to clear. Reusing a
  pattern the app already has beats introducing a second idiom for time. (The date chips have since
  become `DatePicker`: a popover with preset shortcuts above a month grid, same chip anatomy.)

- **DE2 — No due *time* requirement (diverges from Todoist).** Todoist won't let you set a duration
  until the task has a clock time, because there a duration is a calendar block. This app's
  `dueDate` is a Postgres `DATE` end to end (`@db.Date`, DTO `'YYYY-MM-DD'`, zod
  `/^\d{4}-\d{2}-\d{2}$/`), so requiring a time would mean migrating every date surface to
  timestamps. `estimate` is a standalone minutes field — the Linear/TickTick model. Time-blocking
  is a v2 question, not a prerequisite.

- **DE3 — Estimate caps at 24h (1440 min); `timeUsed` keeps its 99:59 (5999) bound.** The 24h cap
  is [Todoist's][td] deliberate nudge to split oversized tasks. The two bounds staying different is
  intentional: tightening `timeUsed` would make an already-stored value fail validation on the next
  save, which is a worse outcome than a cosmetic inconsistency.

- **DE4 — Routines carry an estimate that instances inherit at spawn.** A daily 20m routine should
  contribute to the day total without being re-estimated every morning. The value is **copied** into
  each instance at materialization, not read through the relation — consistent with how `content`,
  `description`, and `priority` already work, and with `updateRoutine`'s existing contract that
  editing a template leaves already-spawned instances alone. Past instances are not backfilled.

- **DE5 — Day totals are an honest lower bound.** Only tasks that *have* an estimate contribute.
  The total is labelled `~` and shown alongside a count of unestimated tasks, rather than guessing a
  default for tasks with no estimate. A made-up number in a planning aid is worse than a visibly
  incomplete one.

[td]: https://www.todoist.com/help/articles/set-a-task-duration-L1kYkZv8d

---

## 2. Product requirements

### Goals

- Set an estimate while creating a task, without leaving the composer or opening a second dialog.
- Enter any duration in whatever notation comes to mind, and never be told only that it is wrong.
- See what a day costs — on Today, and per column on the Upcoming board.
- Let routines carry a default estimate so recurring load is counted automatically.
- Let the agent set estimates when it processes the Inbox into well-formed tasks.

### Non-goals (v1)

- Time *blocking* — placing a task at a clock time on a calendar (needs DE2's timestamp migration).
- Running timers, pomodoro, or start/stop tracking. `timeUsed` stays manually entered.
- Estimate accuracy analytics ("you underestimate by 40%"). The data to compute it is now recorded;
  surfacing it is a v2 feature.
- Capacity warnings ("today is overbooked"). Show the number; let the user judge.
- Story points or any unit other than minutes.

### Behavior spec

**Entry.** A chip sits beside Date and Priority in the composer: `⏱ Estimate` when empty,
`⏱ 30m` with an `X` to clear when set. It opens a menu of presets — 15m, 30m, 45m, 1h, 1h30, 2h —
above a separator and a free-text field. Typing parses live: valid input previews the normalized
form, invalid input marks the field and refuses to commit. `Enter` commits and closes.

**Parsing.** Case-insensitive, spaces optional:

| Input | Minutes | Note |
|---|---|---|
| `30` | 30 | bare number = minutes; the most common thing people type |
| `30m` `30 min` `30 mins` `30 minutes` | 30 | |
| `2h` `2hr` `2hrs` `2 hours` | 120 | |
| `1h30` `1h30m` `1h 30m` | 90 | Jira / Todoist idiom |
| `1.5h` | 90 | fractional hours |
| `1:30` | 90 | back-compat — existing `timeUsed` values still parse |
| `""` | `null` | empty clears the field |
| anything else | `null` | invalid; the control refuses it |

**Persistence.** The composer keeps the estimate after submit, the way it already keeps date,
priority, and project — tasks entered in a burst tend to be the same rough size.

**Display.** Task rows and board cards show `⏱ 30m` for the estimate and a separate badge for
`timeUsed`, with distinct icons so expected and actual can't be misread as one number. Format is
`1h 30m` / `45m` / `2h` — never `01:30`.

**Totals.** Today's header shows `~3h 15m planned` for active tasks due today, plus
`· 2 unestimated` when some have none. Each Upcoming column header shows its own total.

**Routines.** The routine dialog gets the same chip. Instances inherit the template's estimate at
spawn, backfill, complete-ahead, and click-to-materialize (ROUTINES §RV10). Editing a template does
not touch existing instances.

### Acceptance

- Typing `90` into the field formerly labelled "Time used" saves 1h 30m. (Today it is rejected.)
- A task created with the `30m` preset shows `30m` on its row in Today, Inbox, and Upcoming.
- Creating two tasks in a row without closing the composer gives both the same estimate.
- Two tasks due today at 30m and 1h make Today's header read `~1h 30m planned`.
- Dragging a task between Upcoming columns moves its contribution between the two column totals.
- A routine with a 20m estimate spawns today's instance already showing `20m`.
- Clearing an estimate (the chip's `X`, or emptying the field) writes `null`, not `0`.
- "add a task to write the report, about two hours" via chat creates a task showing `2h`.

---

## 3. Technical design

### 3.1 Schema

`estimate Int?` on **both** `Task` and `Routine` — nullable minutes, mirroring `timeUsed`'s shape
exactly. One migration, `add_estimates`. No index: estimates are never a query predicate, only a
projection and a client-side sum.

### 3.2 Parser (`src/lib/duration.ts`)

The file is rewritten. `minutesToHHMM` / `hhmmToMinutes` are removed — `parseDuration` subsumes
`hhmmToMinutes` (it accepts `1:30`) and `formatDuration` replaces `minutesToHHMM` everywhere.

```ts
parseDuration(text: string): number | null   // "1h30" → 90; "" and invalid → null
formatDuration(minutes: number): string      // 90 → "1h 30m"; 45 → "45m"; 120 → "2h"
sumEstimates(tasks: { estimate: number | null }[]): number
```

Pure and dependency-free, so it is directly unit-testable if a test runner ever lands (TDD §8).

### 3.3 The control (`src/components/duration-picker.tsx`)

One component, two shapes: a compact chip for the composer, and a full-width trigger for a form grid
cell in the edit and routine dialogs. Two details are non-obvious and shared with `DatePicker`:

- the embedded input is wrapped in `onKeyDown={(e) => e.stopPropagation()}`, or `DropdownMenu`'s
  typeahead swallows the keystrokes;
- the clear `X` is a sibling button *outside* the trigger, so clicking it doesn't open the menu.

### 3.4 Read path & DTO

`estimate: number | null` on `TaskDTO` and `RoutineDTO`, threaded through the usual seven points in
`src/lib/data/tasks.ts` (`TaskRow`, `SELECT`, `toDTO`, `CreateTaskInput`, create data,
`UpdateTaskInput`, the `updateTask` field-copy chain) and the equivalents in `routines.ts`.

### 3.5 Routine → instance copying

`src/lib/data/routines.ts` copies template fields into a `Task` row in **five** places, all of which
must carry `estimate`:

| Site | Copies from |
|---|---|
| `setRoutineDay` — mint a corrected past day | template |
| `completeOccurrence` / `materializeOccurrence` — act on a future occurrence | template |
| `materializeRoutines` step 2 — backfill unseen days | template |
| `materializeRoutines` step 3 — spawn today | template |
| ~~`materializeRoutines` step 1 — mint a catch-up task~~ | ~~**the instance**, not the template~~ |

The last one was the subtle one — catch-ups copied the instance the user actually saw, so
`estimate` had to be in the `stale` query's select. ROUTINES §RV10 removed the mint entirely
(2026-08-02), leaving four sites that all copy the template.

### 3.6 Agent tools

`estimate` joins the `createTask` and `updateTask` input schemas in `src/lib/ai/tools.ts` **and**
the `brief()` projection — a field the model can write but never read back is a field it will
overwrite blindly. The INBOX REVIEW section of the chat system prompt asks for an estimate as part
of turning a vague capture into a concrete task.

---

## 4. Build phases

Each phase ends runnable.

### Phase E1 — data layer + parser

> **Prompt:** Add `estimate Int?` to `Task` and `Routine` in `prisma/schema.prisma`; migrate as
> `add_estimates`. Rewrite `src/lib/duration.ts` with `parseDuration` / `formatDuration` /
> `sumEstimates` per §3.2, deleting the `HH:MM` pair. Thread `estimate` through `TaskDTO`,
> `src/lib/data/tasks.ts`, the zod schemas in `src/app/actions/tasks.ts` (cap 1440), and
> `src/hooks/use-tasks.ts` including the optimistic literal.

**Done when:** `npm run db:migrate` adds two nullable columns and the app builds with `estimate`
readable on every task, though nothing sets it yet.

### Phase E2 — the control, the composer, the badges

> **Prompt:** Build `src/components/duration-picker.tsx` per §3.3. Add the chip to `quick-add.tsx`
> beside Priority, persisting across submits. In `edit-task-dialog.tsx` replace the `HH:MM` Time
> used input with the picker and add an Estimate field. Render both badges in `task-row.tsx` and the
> `TaskCard` in `views/upcoming-board.tsx`.

**Done when:** every acceptance bullet about entry and display passes, and `90` is a valid
"time used".

### Phase E3 — routines

> **Prompt:** Add `estimate` to `RoutineDTO`, the routines data layer, and the routine zod schemas.
> Thread it through all five copy sites in §3.5. Add the picker to `routine-dialog.tsx` and a badge
> to the routines page row.

**Done when:** a routine with an estimate spawns instances that already carry it, and the Activity
grid is unchanged.

### Phase E4 — day totals

> **Prompt:** Show `~<total> planned` (plus an unestimated count) under the Today header and in each
> Upcoming column header, using `sumEstimates`.

**Done when:** totals match the visible tasks and follow a drag between columns.

### Phase E5 — agent

> **Prompt:** Add `estimate` to the `createTask`/`updateTask` tool schemas and to `brief()`. Extend
> the INBOX REVIEW prompt to set one.

**Done when:** asking the chat panel for a task "that'll take about two hours" produces a task
showing `2h`.

---

## 5. Deferred (v2 candidates)

- **Estimate vs. actual analytics** — the comparison the two fields now make possible.
- **Capacity warning** on a day whose total exceeds a configured working day.
- **Estimate-aware review** — `/api/review` balancing days by load rather than count.
- **Timers** — start/stop that writes `timeUsed`, removing the last manual duration entry.
- **Time blocking** — the DE2 question: clock times on tasks and a day timeline.
- **Natural language in the title** (`write report for 2h`) — cheap once a title tokenizer exists,
  but there is no NL parsing of any kind in the composer today, so it isn't cheap yet.

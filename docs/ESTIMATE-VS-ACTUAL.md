# Estimate vs. actual — Feature Spec

**Owner:** Guoxuan Xu
**Status:** v1
**Last updated:** 2026-10-31
Companion docs: [ESTIMATES.md](./ESTIMATES.md) · [ROUTINES.md](./ROUTINES.md) ·
[DECISIONS.md](./design/DECISIONS.md)

---

## 1. Summary

A section at the top of `/activity` that answers "how long did finished work take against what I
estimated?": for a rolling window ending today, one row per project with the planned hours as a
track and the logged hours filling it, so a run past the estimate shows as an amber overrun and a
shortfall as an uncovered remainder. Each project with enough data also names its biggest miss on a
thinner bar beneath it, because one task can set a project's whole gap.

This is the comparison ESTIMATES.md §5 deferred: `estimate` and `timeUsed` have been recorded side
by side since DE1, and nothing read them together.

### Decisions (owner-decided 2026-10-31)

- **EA1 — Group by project; no labels field.** A user who files by kind of work (networking,
  learning, job hunting) reads the rows as categories; a user who files by project reads them as
  projects. A task belongs to exactly one, so nothing is counted twice.

- **EA2 — A row counts on a user-local day; which day depends on the row.** An ordinary task counts
  on the day it was completed, in the user's timezone. A routine day counts on the day it was
  *due*, the day the Activity grid below draws it on, so a day made up late lands in the same week
  in both widgets. Missed days are excluded: no work happened.

- **EA3 — Only tasks with both numbers are compared, and the coverage is always printed.** A task
  needs a positive `estimate` and a positive `timeUsed`. A zero on either side has no meaningful
  ratio, and guessing a missing one (Sunsama's "backfill time used with the estimate") would hide
  exactly what the footer exists to show: how many finished tasks were never timed. The footer reads
  `Based on X of Y done tasks with an estimate and time used`.

- **EA4 — A routine and its recorded days share a project.** Moving a routine moves its history.
  `updateTask` refuses to move a routine day singly, so without the cascade a moved routine's past
  would stay in the old project for good, split across two rows here and two project views.

- **EA5 — Under 5 compared tasks, a project is shown but not judged.** It is drawn at half opacity
  with `too few · n`, gets no biggest-miss bar, and is left out of the headline. One 15-minute task
  that took 2 minutes is not evidence about a category.

- **EA6 — Reads never write.** The route is separate from `GET /api/tasks`, which records missed
  routine days on every read and caps completed rows at 200 (ROUTINES §RV8).

## 2. Product requirements

### Goals

- See at a glance which projects ran over or under their estimates, and by how many hours.
- See which single task created a project's gap.
- Make thin timing data obvious instead of drawing conclusions from it.
- Work at 375px with no horizontal scrolling.

### Non-goals (v1)

- Per-task ratio distributions, calibration curves, or a suggested correction factor.
- Planned time for open work (the Upcoming board's column totals cover a day's plan).
- Trend lines across weeks. With most tasks untimed the weekly series is mostly empty.
- An MCP tool. `list_tasks` already returns `projectId`, `estimate` and `timeUsed`.

### Behavior spec

**Window.** `7 days` / `4 weeks` / `12 weeks`, rolling and ending on the user's local today;
default 12 weeks, since timing is sparse and a short window is usually empty.

**Headline.** Up to two judged projects outside ±15% of plan, largest gap first: `Samsung ran 4.3h
over its plan; Job hunting ran 4.6h under its plan.` If none: `Every project with 5 or more timed
tasks landed within 15% of its plan.` If no project is judged: `No project has 5 timed tasks in
this window yet.`

**Rows.** Judged projects first, then thin ones, each group by planned hours. Each row: name and
`n tasks` (or `too few · n`), `logged of planned` on the right, then the bar. All bars, including
biggest-miss bars, share one hours axis with up to three hairline ticks, labelled once beneath.
Bar anatomy: planned = track; logged fills from the same baseline; logged beyond planned continues
in amber; planned never reached stays as a blue-tinted remainder.

**Biggest miss.** For judged rows: the task with the largest `|timeUsed − estimate|`, ties to the
larger estimate, as `↳ biggest miss: <title>` (with `↻` for a routine day) and its own pair.

**Footer.** Projects with no timed tasks on one muted line; then the coverage line and the rules.

### Acceptance

- A task completed at 23:30 Pacific on the 10th counts on the 10th, not the 11th.
- A routine day due Monday and ticked Thursday counts on Monday.
- A task with estimate 0, time used 0, or either missing counts toward `done` but not `timed`.
- A project with 4 compared tasks is faded, says `too few · 4`, and has no biggest-miss bar.
- Moving a routine to another project moves its past days, and the next load shows them there.
- Renaming a project updates the row's name without a reload.
- `GET /api/activity/estimate-vs-actual` without a session returns 401 JSON; reading it writes no rows.

## 3. Technical design

- **`src/lib/estimate-accuracy.ts`** — pure. `dayOf` applies EA2, `isTimed` EA3,
  `summarizeAccuracy(rows, from, to, tz)` groups and picks each project's biggest miss; `onPlan`
  and `formatHours` serve the view. Tested in `estimate-accuracy.test.ts`.
- **`src/lib/data/estimate-accuracy.ts`** — `getEstimateAccuracy(userId, from, to, tz)`: one
  `findMany` on completed rows whose `completedAt` or (for routine rows) `dueDate` falls within the
  window padded by a calendar day on each side; the pure function decides exact membership after
  timezone conversion.
- **`GET /api/activity/estimate-vs-actual?days=N`** — same window contract and clamp as
  `/api/routines/history` (`clampHistoryDays`, 1..371). Returns `{from, to, done, timed,
  projects}`; project ids only, names are joined on the client from `useProjects`.
- **`useEstimateVsActual(days)`** in `src/hooks/use-tasks.ts`, keyed under `TASKS_KEY` so every
  write that invalidates the task list refreshes it.
- **`EstimateVsActual`** in `src/components/views/estimate-vs-actual.tsx`, mounted by
  `src/app/(app)/activity/page.tsx` as a sibling of `ActivityGrid`, which returns early when there
  are no routines. Plain divs, no chart library.
- **`updateRoutine`** cascades a `projectId` change to `tasks` where `routineId = id` in the same
  transaction (EA4).

## 4. Deferred

- A per-routine calibration row ("planned 30, typically takes 60 — set to 60?"), since a routine
  copies its estimate onto every day and one wrong number repeats.
- A tap-through from a row to that project's compared tasks.
- Nudging the user to log time used when coverage drops, if the footer alone doesn't change habits.

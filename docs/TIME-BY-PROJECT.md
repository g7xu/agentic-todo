# Time by project — Feature Spec

**Owner:** Guoxuan Xu
**Status:** v1 shipped
**Last updated:** 2026-10-30
Companion docs: [ESTIMATES.md](./ESTIMATES.md) · [ROUTINES.md](./ROUTINES.md) ·
[DECISIONS.md](./design/DECISIONS.md)

---

## 1. Summary

A section at the top of `/activity` that answers "where did my finished work go?": for a rolling
window ending today, the completed tasks grouped by project, with the estimated minutes, each
project's share of them, and how much of each number rests on estimates at all.

Projects are the grouping because every task and routine already belongs to exactly one, and the
app already has the create, rename, delete and move flows for them. A user who files by kind of
work (networking, learning, job hunting) reads the section as time by category; a user who files by
project reads it as time by project. Nothing in the code changes what a project means.

### Decisions (owner-decided 2026-10-30)

- **DT1 — Group by project; no labels field.** A second taxonomy would need a schema change, a
  picker on every task surface, an MCP field and a backfill, to answer a question one required
  field already answers. A task counts in exactly one project, so shares sum to 100%.

- **DT2 — A row counts on a user-local day; which day depends on the row.** An ordinary task
  counts on the day it was completed, in the user's timezone. A routine day counts on the day it
  was *due*, the day the Activity grid below draws it on, so a day made up late lands in the same
  week in both widgets. Missed days are excluded: they carry the template's estimate but no work
  happened.

- **DT3 — Shares are shares of estimated minutes.** `estimate` is set on more finished tasks than
  `timeUsed` is (90 vs 46 of the owner's last 200), and routine days always carry one. A null
  estimate adds nothing and is counted as *unestimated* instead (DE5's lower bound). Because
  routine days are always estimated and one-off tasks often aren't, each row also says how many of
  its tasks came from routines and how many minutes those were; without that the share quietly
  favours whatever has routines. `timeUsed` is summed separately and never mixed into the share.

- **DT4 — A routine and its recorded days share a project.** Moving a routine moves its history.
  `updateTask` refuses to move a routine day singly, so without the cascade a moved routine's past
  would stay in the old project for good, split across two rows here and two project views.

- **DT5 — Reads never write.** The route is separate from `GET /api/tasks`, which records missed
  routine days on every read and caps completed rows at 200 (ROUTINES §RV8).

## 2. Product requirements

### Goals

- See, for the last week / four weeks / twelve weeks, how finished work split across projects.
- Keep a project with finished but unestimated work visible, with its count, rather than hiding it
  behind a 0%.
- Work at 375px with no horizontal scrolling.

### Non-goals (v1)

- Planned or upcoming time by project (the Upcoming board's column totals cover a day's plan).
- Estimate-versus-actual analytics (ESTIMATES §5).
- Trend lines, per-project colours, an MCP tool. `list_tasks` already returns `projectId`,
  `estimate`, `timeUsed` and `completedAt` for the recent window an agent would ask about.

### Behavior spec

**Window.** `7 days` / `4 weeks` / `12 weeks`, rolling and ending on the user's local today;
default 4 weeks. A calendar week was rejected: on a Sunday or Monday it holds a day or two.

**Header.** `~14h 20m estimated · 41 done · 18 unestimated`, or `Nothing completed in this window.`

**Rows.** One per project with at least one counted task, ordered by estimated minutes then by
tasks done. Each row: the project name; `~2h 30m · 34%` (or `no estimates`); a bar whose width is
the share; a muted line `9 done · 4 unestimated · 6 from routines (~3h) · 1h 10m logged on 2`.
Names come from the projects list, so a rename shows immediately. Projects with nothing counted
are listed on one muted line. When tasks were done but none carry an estimate, a note says
percentages appear once they do.

### Acceptance

- A task completed at 23:30 Pacific on the 10th counts on the 10th, not the 11th.
- A routine day due Monday and ticked on Thursday counts on Monday.
- A missed routine day contributes nothing.
- A project with two finished tasks and no estimates shows `2 done · 2 unestimated` and an empty bar.
- Moving a routine to another project moves its past days' rows with it, and the next load of the
  section shows them under the new project.
- Renaming a project updates the row's name without a reload.
- `GET /api/activity/time-by-project` without a session returns 401 JSON; reading it writes no rows.

## 3. Technical design

- **`src/lib/time-share.ts`** — pure. `dayOf(row, tz)` applies DT2; `summarizeTimeByProject(rows,
  from, to, tz)` filters to the window and groups. Tested in `time-share.test.ts`.
- **`src/lib/data/time-share.ts`** — `getTimeByProject(userId, from, to, tz)`: one `findMany` on
  completed rows whose `completedAt` or (for routine rows) `dueDate` falls within the window padded
  by a calendar day on each side, then the pure function decides exact membership after timezone
  conversion. No index on `completedAt`; the `userId` prefix of `@@index([userId, dueDate, status])`
  is enough at a few thousand rows a year.
- **`GET /api/activity/time-by-project?days=N`** — same window contract and clamp as
  `/api/routines/history` (`clampHistoryDays`, 1..371, default 84). Returns `{from, to, totals,
  projects}`; project ids only, no names.
- **`useTimeByProject(days)`** in `src/hooks/use-tasks.ts`, keyed under `TASKS_KEY` so every write
  that invalidates the task list refreshes it.
- **`TimeByProject`** in `src/components/views/time-by-project.tsx`; mounted by
  `src/app/(app)/activity/page.tsx` as a sibling of `ActivityGrid`, which returns early when there
  are no routines.
- **`updateRoutine`** cascades a `projectId` change to `tasks` where `routineId = id` in the same
  transaction (DT4).

## 4. Deferred

- A bulk "move to project" tool, if re-filing history through MCP turns out to be common.
- Per-project colours; `Project.color` exists but nothing sets it.
- An MCP read tool over the same summary, if an agent ever needs a window past `list_tasks`'s cap.

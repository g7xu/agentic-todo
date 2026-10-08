# Deadlines (planned date vs. hard date) — Feature Spec

**Owner:** Guoxuan Xu
**Status:** Implemented 2026-08-01 (PR #22)
Companion docs: [TDD.md](./design/TDD.md) · [ESTIMATES.md](./ESTIMATES.md) · [ROUTINES.md](./ROUTINES.md)

---

## 1. Summary

A task now carries two dates, because one field can't honestly mean both "when I'll work on this"
and "when it's actually due":

| field | meaning | who moves it |
|---|---|---|
| `dueDate` | **planned** date — when the user intends to do it | everything: board drag, chat `rescheduleTask`, bulk reschedules, (future) triage |
| `deadline` | **hard** date — when it's actually due | deliberate edits only: edit dialog, quick-add chip, an explicit chat instruction |

This is Todoist's date-vs-deadline split. The immediate payoff is honesty in day-to-day
rescheduling (pushing the plan around never quietly moves the real due date). The forward-looking
payoff is deadline-aware triage: the balancer gets a hard placement boundary, `unschedule` becomes a safe
verdict (see DL3), and the classifier can tell "dodged but harmless" from "dodged into a wall".

### Decisions (owner-decided 2026-08-01)

- **DL1 — Nothing moves a deadline implicitly.** `moveTaskAction` (board drag), the chat
  `rescheduleTask`/`bulkReschedule` tools, and any future automated reschedule touch only
  `dueDate`. The chat agent may set/clear a deadline via `createTask`/`updateTask`, but its system
  prompt requires the user to have *stated* one ("the real deadline is Friday") — never inferred.

- **DL2 — Deadlines are editable on routine instances.** ROUTINES.md RV1 locks an instance's
  *planned* date (each instance stands for a specific day); the deadline carries no such meaning
  and stays editable everywhere. Routine *templates* don't have deadlines — a recurring hard date
  is a contradiction in v1. Consequently a deadline on an instance exists only because the user
  put it there, which is why the catch-up mint must copy it (DL5).

- **DL3 — An arrived deadline is un-ignorable.** The Today view surfaces a task when **either**
  date has arrived (`urgentDate()` in `src/app/(app)/today/page.tsx`): a deadline-of-today task
  with no planned date still shows up. Clearing a planned date therefore can't hide real work —
  which is what will make triage's `unschedule` verdict safe to propose liberally.

- **DL4 — Chat's 'today'/'overdue' scopes match the Today view.** TDD §6.2's parity contract
  ("what's due today in chat agrees with the view named Today") now includes arrived deadlines in
  `listTasks`. The `week` scope stays planned-date-only, mirroring the board, which is a planning
  surface keyed on `dueDate` — deadline-only tasks don't appear there.

- **DL5 — Catch-ups copy the instance's deadline.** ~~The materialize step-1 mint copies from the
  instance the user actually saw (ROUTINES §RV7 / ESTIMATES §3.5's "subtle" copy site), and
  `deadline` joins that copy list. Dropping it would silently lose a hard date the user set.~~
  **Moot since ROUTINES §RV10 (2026-08-02): no catch-up is minted at all, so there is no copy to
  get wrong.** A deadline set on an instance now lives and dies with that instance.

- **DL6 — Warn, don't validate.** No constraint forces planned ≤ deadline. Badges carry the
  signal instead: **red** when `deadline <= today` (the hard date has arrived/passed), **amber**
  when `dueDate > deadline` (the plan schedules the work after it's due — a visible lie). A form
  error would block honest states like "deadline passed, I'm replanning".

- **DL7 — The composer doesn't persist the deadline across burst entries.** Date, priority,
  estimate, and project all persist after submit (tasks entered in a burst share them); the
  deadline resets, because silently stamping the previous task's hard date onto the next capture
  is worse than re-picking it.

- **DL8 — `brief()` includes `deadline`.** ESTIMATES §3.6's rule: a field the model can write but
  never read back is a field it overwrites blind.

## 2. Touch points

Schema: `deadline DateTime? @db.Date` on `Task` (migration `add_task_deadline`). Threaded through
`TaskDTO`, `src/lib/data/tasks.ts` (create/update/DTO), the zod schemas in
`src/app/actions/tasks.ts`, the optimistic literals in `src/hooks/use-tasks.ts`, quick-add's
Deadline chip (`Target` icon, same anatomy as the Date chip), the edit dialog (beside Due date),
badges in `task-row.tsx` and the board's `TaskCard`, the Today view's `urgentDate()`, the chat
tools + system prompt. (It also threaded through the catch-up mint in `src/lib/data/routines.ts`,
until ROUTINES §RV10 removed that mint.)

## 3. Deferred

- **Deadline-aware triage** — the reason this field exists; the removed triage spec proposed a balancer placement
  window `[proposed … min(horizon, deadline)]`, a `conflict` outcome for can't-fit-before-deadline,
  and deadline distance as a classifier signal.
- **Deadline on the Upcoming board** — deadline-only tasks have no column today; a "Deadlines"
  rail or ghost cards are a design question, not a data one.
- **Recurring deadlines on templates** — excluded by DL2 until a real use case shows up.
- **Natural language in the composer** ("report by Friday") — same tokenizer gap as ESTIMATES §5.

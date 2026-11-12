# MCP tools: the 29-tool surface mapped to the 26-tool surface

Decision DM14 in [MCP.md](./MCP.md). Every tool of the PR #65 surface still has a home, and
`src/lib/mcp/tools.test.ts` ("keeps every capability of the earlier surface") fails if one
disappears.

## What changed and why

- **One tool per job for task writes.** `complete_task` and `bulk_complete` did the same thing
  through the same rules (`setTaskStatus` and `bulkComplete` share them, timer stop included), so a
  model had to pick between two names for one job. Now `complete_tasks`, `delete_tasks` and
  `reschedule_tasks` each take 1 to 100 ids and report `applied`, `skipped` (with a reason) and
  `tasksChanged`.
- **Names say what the tool does.** `uncomplete_task` was already titled "Reopen task", and
  `update_project` could only rename.
- **One edit tool per review note.** `update_review_note` changes the text, the column, or both in
  one call, so "rewrite this and move it to action" is one call instead of two.
- **No nested claimId.** `claim_task` returned `{ claimed: { task, claimId, ... } }` and
  `{ claimed: null }`. It now returns `{ task, claimId, claimExpiresAt, log }` and `{ task: null }`,
  so the id the next call needs sits next to the task it holds.
- **Chained steps in one call.** `finish_task` and `request_input` take `next: true` and return the
  next claimed task as `next`, in `claim_task`'s shape. A run that works a queue of N tasks makes
  N + 1 calls instead of 2N + 1. `release_task` has no `next`, because the task it releases goes
  straight back to the queue and would be claimed again.
- **Descriptions say what comes back.** Every tool's description now ends with the shape of its
  result. Descriptions still state facts about the data only (the surface test's DIRECTIVE check).

## Old to new

| Old tool (29) | New tool (26) | Arguments then | Arguments now | Result then | Result now |
|---|---|---|---|---|---|
| `list_tasks` | `list_tasks` | status, projectId, agentState | same | `{ today, timezone, tasks }` | same |
| `create_task` | `create_task` | task fields | same | the task | same |
| `update_task` | `update_task` | id + fields | same | the task | same |
| `complete_task` | `complete_tasks` | `{ id }` | `{ ids: [id] }` | the task | `{ applied, skipped, tasksChanged }` |
| `bulk_complete` | `complete_tasks` | `{ ids }` | same | `{ applied, skipped, tasksChanged }` | same |
| `uncomplete_task` | `reopen_task` | `{ id }` | same | the task, or `{ removed, id }` | same |
| `delete_task` | `delete_tasks` | `{ id }` | `{ ids: [id] }` | `{ deleted, id }` | `{ applied, skipped, tasksChanged }` |
| `bulk_delete` | `delete_tasks` | `{ ids }` | same | `{ applied, skipped, tasksChanged }` | same |
| `bulk_reschedule` | `reschedule_tasks` | `{ ids, dueDate }` | same | `{ applied, skipped, tasksChanged }` | same |
| `get_task` | `get_task` | `{ id }` | same | `{ task, log }` | same |
| `claim_task` | `claim_task` | id?, leaseMinutes? | same | `{ claimed: { task, claimId, claimExpiresAt, log } \| null }` | `{ task, claimId, claimExpiresAt, log }` or `{ task: null }` |
| `log_task_progress` | `log_task_progress` | id, claimId, note, leaseMinutes? | same | `{ claimExpiresAt }` | same |
| `request_input` | `request_input` | id, claimId, question | + `next?` | the task | `{ task }`, plus `next` when asked |
| `release_task` | `release_task` | id, claimId, note? | same | the task | `{ task }` |
| `finish_task` | `finish_task` | id, claimId, report | + `next?` | the task | `{ task }`, plus `next` when asked |
| `suggest_task` | `suggest_task` | task fields | same | the task | same |
| `list_projects` | `list_projects` | none | same | projects | same |
| `create_project` | `create_project` | `{ name }` | same | the project | same |
| `update_project` | `rename_project` | `{ id, name }` | same | `{ id, name }` | same |
| `delete_project` | `delete_project` | `{ id }` | same | `{ deleted, id }` | same |
| `list_routines` | `list_routines` | none | same | routines | same |
| `get_routine_history` | `get_routine_history` | days? or from/to | same | `{ from, to, routines }` | same |
| `list_reviews` | `list_reviews` | none | same | weeks | same |
| `get_review` | `get_review` | week? | same | the board | same |
| `add_review_note` | `add_review_note` | week?, kind?, content | same | the note | same |
| `update_review_note` | `update_review_note` | `{ id, content }` | `{ id, content?, kind? }`, at least one | the note | same |
| `move_review_note` | `update_review_note` | `{ id, kind }` | `{ id, kind }` | the note | same |
| `delete_review_note` | `delete_review_note` | `{ id }` | same | `{ deleted, id }` | same |
| `close_review` | `close_review` | week, carry | same | the closed board | same |

Scopes and annotations are unchanged: the id-list task tools need `tasks:write` and stay
destructive, and the hand-off tools still accept `tasks:agent`. (`finish_task` was annotated destructive while
it completed the task; it no longer does, see AGENT-TASKS.md AT8.)

## Behaviour that moved

Three single-id errors became entries in `skipped`, because the id-list tools never fail a
whole call for one bad id:

| Case | Before | Now |
|---|---|---|
| Completing a missed routine day | `complete_task` error "Missed routine days can't be completed" | `skipped: [{ id, reason: "routine_day_missed" }]` |
| Completing or deleting an id the user doesn't own | error "Task not found" | `skipped: [{ id, reason: "not_found" }]` |
| Completing an already-completed task | the task, `completedAt` unchanged | `applied: [id]`, `tasksChanged: false`, `completedAt` unchanged |

The single-id complete returned the whole task; `complete_tasks` returns ids only. `get_task` or
`list_tasks` reads the task back when the caller needs its fields.

`update_review_note` with both fields writes the text first, then moves the note. If the text
edit is refused (a closed week, an unknown id), nothing moves.

## Parity check

- Unit tests: 164 pass (`npx vitest run`), up from 158. New ones cover `complete_tasks` with one
  id (missed day, already completed, unknown id), `reopen_task`, `delete_tasks` with a foreign id,
  an empty id list, `update_review_note` (text, column, both, neither, refused), the flat
  `claim_task` result, `{ task: null }`, and `next: true` on `finish_task` and `request_input`,
  including an empty queue.
- `npx tsc --noEmit` and `eslint` are clean. The live end-to-end scripts in `tests/e2e/` use the
  new names; they run against a deployment and were not run here.

## Local comparison (Nov 11, 2026)

The same scenarios ran against PR #65 and this branch, each on its own `next dev` server and
throwaway Postgres 16 database, through the real `/api/mcp` endpoint. Calls are the agent run's
own; setup and read-back calls are not counted.

| Scenario | PR #65 (29 tools) | This branch (26 tools) |
|---|---|---|
| 1. Claim, log progress, finish | 3 | 3 |
| 2. Ask a question / resume after the answer | 2 / 2 | 2 / 2 |
| 3. Two runs race for one task, 5 lockstep + 5 staggered trials | 0 of 10 double claims | 0 of 10 |
| 4. One run works a queue of 5 tasks until it is empty | 11 | 6 (`next: true`) |
| 5. Complete a task, delete a task, rewrite a note and move it to action | 4 | 3 |

Every scenario ended in the same state on both branches. The only tool errors in either log are
the 10 expected "Task is claimed by another run" refusals from the races.

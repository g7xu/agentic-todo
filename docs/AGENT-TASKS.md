# Agent hand-off: tasks an agent works unattended

**Owner:** Guoxuan Xu
**Status:** Proposed 2026-11-11 (branch `claude/agent-task-handoff`)
Companion docs: [MCP.md](./MCP.md) · [AGENT.md](./AGENT.md)

---

## 1. Summary

A connected AI agent (any MCP client, running on a schedule) works the tasks the user hands to it and leaves
every other task alone. It claims a task before working it, so two runs never work the same one;
it parks a task on the user with one question when it needs a decision; it reports in a log on
the task rather than in the description; and it may suggest new tasks, which it does not work
until the user hands them over.

## 2. Decisions

- **AT1 — The user hands tasks over.** `agentState` is null on an ordinary task. "Hand to AI agent"
  in the edit dialog sets it to `ready`; "Take back" clears it from any state. Routine days cannot
  be handed over: their date and outcome are the routine's.
- **AT2 — One state field, five values.** `suggested` (the agent proposed it), `ready` (waiting
  for a run), `working` (claimed), `needs_input` (waiting on the user's answer), `done` (the agent
  finished and reported; the task stays active until the user reviews it, AT8). A CHECK constraint holds the vocabulary.
- **AT3 — Claims are a compare-and-set with a lease.** `claim_task` sets `working`, a fresh
  `claimId` and `claimExpiresAt` in one conditional `updateMany` whose `where` is "ready, or
  working with a lapsed lease". Of two racing runs exactly one gets `count = 1`. Every later write
  by the run (`log_task_progress`, `request_input`, `release_task`, `finish_task`) carries the
  claimId in its `where`, so a run whose task was taken over, taken back or completed by the user
  fails with a readable error instead of writing over the new state. The lease (default 30 min, at
  most 4 h) only decides when another run may take over; a progress note renews it. A CHECK
  constraint keeps `claimId` and `claimExpiresAt` set exactly while `working`.
- **AT4 — One question at a time.** `request_input` moves the task to `needs_input` with
  `agentQuestion`, drops the claim and logs the question. The edit dialog shows the question with
  an answer box; answering logs the answer and returns the task to `ready`. The next claim returns
  the recent log, so the run sees the answer.
- **AT5 — Reports live in an append-only log.** `task_activities` (author `agent` | `user`, kind
  `progress` | `question` | `answer` | `report` | `released`). `finish_task` logs the report and
  sets `done` in one transaction; it does not complete the task (AT8).
  The description stays the user's: no hand-off tool writes it.
- **AT6 — Suggestions are inert.** `suggest_task` creates a task with `agentState = suggested`.
  It is not claimable; "Let AI agent do it" in the dialog makes it `ready`. A suggestion the user
  wants to do themselves stays theirs; one they do not want is deleted like any task.
- **AT7 — Scope `tasks:agent` for unattended connections.** The hand-off tools accept
  `tasks:agent` or `tasks:write`; the general edit and delete tools still need `tasks:write`. The
  consent page offers "Agent hand-off only", which swaps `tasks:write` for `tasks:agent` in the
  grant (a strict narrowing, since write already allows the hand-off). Unticked, consent behaves as
  before, and a request with no `scope` still gets `tasks:read tasks:write`.

- **AT8 — The user closes what the agent finished.** A `done` task stays active. "AI agent is
  waiting on you" at the top of the Upcoming board lists every active task from all projects
  whose next step is the user's: `needs_input` tasks first, then `done` ones. Opening one shows
  its question or report. A `done` task leaves the list when the user completes it, or replies: the reply is logged
  as an answer and the task returns to `ready`, so the next claim reads it. "Take back" also
  clears it. Re-opening a completed `done` task lists it again.

## 3. Tools

| Tool | Scope | Does |
|---|---|---|
| `list_tasks` | read | now also filters by `agentState` and `projectId` |
| `get_task` | read | one task with its log |
| `claim_task` | agent | claim a task by id, or the next ready one by priority, deadline, planned date |
| `log_task_progress` | agent | add a progress note, renew the lease |
| `request_input` | agent | park the task on the user with one question; `next: true` also claims the next ready task |
| `release_task` | agent | put the task back to `ready`, with an optional note |
| `finish_task` | agent | log the report and mark the task `done`, left active for the user's review; `next: true` also claims the next ready task |
| `suggest_task` | agent | create a task marked `suggested` |

Hand-off tools are annotated `destructiveHint: false`: they change only the agent's state and
log.

## 4. A scheduled run

1. `claim_task` with no id. It returns `{ task, claimId, claimExpiresAt, log }`; `{ task: null }` means
   nothing is waiting and the run ends.
2. Read the task and the returned log; do the work, calling `log_task_progress` on long work.
3. Either `finish_task` with the report (what was done, the answer, links to anything made), or
   `request_input` with one question, or `release_task` with a note if the run cannot go on.
4. Repeat from 1 while the run has time. `finish_task` and `request_input` take `next: true` to
   claim the next ready task in the same call, so a run that works N tasks makes N + 1 calls
   instead of 2N. Their result is `{ task, next }`, with `next` in `claim_task`'s shape.

## 5. Not built

- Notifying the user when a task enters `needs_input` (the app has no push channel; the agent's
  own surface tells the user).
- Editing or deleting log entries. Deleting the task deletes its log.
- A per-grant limit on how many tasks one run may claim.

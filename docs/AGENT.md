# Agent direction — what the assistant is actually for

**Owner:** Jason (guoxuan.xu8@gmail.com)
**Status:** Direction doc v1 — supersedes [TRIAGE.md](./TRIAGE.md) and [ROUTINES.md](./ROUTINES.md) §R3 *as next work*
**Last updated:** 2026-08-02
Companion docs: [PRD.md](./PRD.md) · [TDD.md](./TDD.md) · [DECISIONS.md](./DECISIONS.md) · [ROUTINES.md](./ROUTINES.md) · [TRIAGE.md](./TRIAGE.md) · [ESTIMATES.md](./ESTIMATES.md)

---

## 1. Why this doc exists

Work on TRIAGE.md stopped mid-plan. The owner's words: *"the current challenge we have is that we
don't know what to do… these plans are not meaningful."* Rather than write a fifth build plan, we
went and measured the problem. This doc records what the data said, what was decided, and what is
still open — so the thread can be picked up cold weeks later without re-deriving it.

Nothing here has been built. This is a direction, not a spec.

## 2. What production said (measured 2026-08-02)

Read-only aggregates against the prod Neon branch. Queries in §8 so they can be re-run.

**Execution is healthy.** 95 one-off completions. Last five weeks: 14 / 14 / 25 / 7 / **35**. Median
capture→done 2.4 days. **Zero overdue** at time of writing.

**The overdue pile was cleared by deferring and deleting — never by sharpening.** The five items
visible in an Aug 2 screenshot:

| Task | Was | Became |
|---|---|---|
| Saving Account Research | Jul 24 | pushed to Aug 7 |
| Medical insurance review | Jul 21 | pushed to Aug 4 |
| Samsung - Fake Tool | Jul 30 | pushed to Aug 3 |
| Close Friend Reachout | Jul 21 | deleted |
| Chase Open Saving Account | Jul 22 | deleted |

**Output routines are kept perfectly; thinking routines are not.**

```
Job Application   17 done    0 missed
Building           6 done    0 missed
日复盘             2 done   13 missed   ← 13 consecutive
周复盘             0 done    1 missed
```

**Tasks are never revisited.** Of 57 active one-offs: 46 have no description, 43 no estimate,
**35 have never been edited since the moment they were typed**. The Inbox holds 23 tasks and **zero**
of them have a description.

**The conclusion.** Vagueness is not the disease — it is the residue of a review that never runs.
Sharpening a task is meta-work, and meta-work here has a 2-in-15 record. That single fact
disqualifies most of what had been designed.

## 3. Decisions (owner-decided 2026-08-02)

- **AG1 — The agent is the thinking layer; views hold state.** Capture and execution already work
  and need no help. Everything between them — making an item concrete, noticing a pattern, running
  the review that gets skipped — is the agent's job.

- **AG2 — No design may require a review session.** This is the binding constraint and the reason
  earlier plans failed. An agent that asks 1–2 clarifying questions across 23 Inbox items *is* a
  review session; it is 日复盘 with better UX, and 日复盘 is 2-for-15. Applies equally to the triage
  digest (which assumed the owner would sit and scan 23 rows) and to the prose INBOX REVIEW workflow
  currently in the chat system prompt.

- **AG3 — Authority: propose inline, one tap to accept.** The agent may compute a rewrite but not
  commit it. Proposals surface where the owner already looks, never batched into a session. This is
  the middle setting: not silent rewriting, not read-only.

- **AG4 — Capabilities are plain functions; every surface is a thin adapter.** `getActivity`,
  `sharpenTask`, `listRoutines` are ordinary TypeScript with no vendor imports. AI SDK tool
  definitions wrap them. An MCP server would wrap the same functions. A durable workflow would
  orchestrate the same functions. This is what "flexible building blocks" means concretely, and it is
  what keeps §5.3's engine choice cheap to reverse.

- **AG5 — Memory is a data-layer problem, not a framework choice.** No workflow engine or agent
  framework fixes recall. See §5.2.

- **AG6 — Durable workflows are deferred to a named trigger, not adopted upfront.** See §5.3.

- **AG7 — Success is behavioral.** The app has to be the thing the owner runs their life on; demo
  value falls out of that being true. Where they conflict, real usage wins.

## 4. Direction: see → show → compose

Strict dependency order. Each stage is useful on its own.

**See.** The agent is blind to what the owner asked for. `brief()` in `src/lib/ai/tools.ts` strips
`completedAt` before handing tasks to the model, and no tool exposes routines at all. It could not
tell you 日复盘 is 2-for-15 — even though `listRoutineHistory()` in `src/lib/data/routines.ts`
already computes exactly that for the Activity grid. *"Review my historical task completion" is not
unbuilt; it is impossible.*

**Show.** Every tool result renders as `· toolName` (`chat-panel.tsx`, the fallback branch). Until
tool output can render as real UI there is no one-tap accept, no readable review, no digest. The
approval card proves the pattern works — it is just hardcoded for one part state.

**Compose.** Plan, review, and sharpening stop being panels bolted above the chat and become tools.
A new capability then costs one tool instead of one panel.

### The building-block audit that motivated this

| Capability | Agent-callable | How it's exposed today |
|---|---|---|
| Task CRUD, bulk ops | **yes** | 12 tools in `src/lib/ai/tools.ts` |
| Human approval | **yes** | `needsApproval` + approval card |
| Plan (brain-dump → tasks) | no | fixed panel + `/api/plan` |
| Review (reschedule proposals) | no | fixed panel + `/api/review` |
| Inbox review | no | prompt paragraph + a button that types a message for you |
| Routines + history | no | invisible to the agent |
| Completion history | no | `brief()` omits `completedAt` / `timeUsed` |
| Rendering tool output | no | everything is `· toolName` |

Three of four "agentic" features bypass the agent entirely.

## 5. The three tracks

### 5.1 Capabilities (the first move)

Pure plumbing. No model calls, no schema change, no UI. Do this first regardless of how §5.2/§5.3
resolve, because every other track calls these functions.

- Widen `brief()` with `completedAt`, `timeUsed`, `createdAt`. Every history question depends on it
  (ESTIMATES §3.6: a field the model writes but never reads is one it reasons about blind).
- `getActivity({ from, to })` — completions per day split one-off vs routine, estimate-vs-actual
  where both exist, per-routine done/missed. **Reuse `listRoutineHistory(userId, from, to)`** — it
  already returns the Activity grid's rows including `missed`, which `listTasks` drops and caps at
  200.
- `listRoutines()` — templates with a readable cadence summary.

**Done when** the chat answers, from real data: *"what did I finish last week?"* → 35 for the week of
Jul 27; *"how's my daily review going?"* → 2 of 15, 13 missed in a row; *"which routines am I
keeping?"* → Job Application and Building, perfect. A wrong number means the block is wrong, not the
model.

### 5.2 Memory

The owner's ask: *"I want my agent to remember our past conversation."* Current reality:

- One conversation per user forever (`@@unique([userId])`); every message persisted to Postgres.
- **`CONTEXT_WINDOW = 20`** (`src/lib/ai/config.ts`) — only the last 20 UIMessages ever reach the
  model. Older ones are stored and rehydrated for *display* and are invisible to the agent.
- Tool-call parts count toward those 20, so two tool-heavy turns can evict real conversation.

So the agent has storage without recall — amnesia past ~20 messages. TDD §10 lists summarization as
a v2 candidate; it never happened.

**LangGraph checkpointing does not solve this** (AG5). Checkpointers persist thread state so a run
can resume, which is roughly what `saveMessage` already does. Recall across weeks needs a memory
layer: rolling summaries, extracted durable facts ("does job applications daily, skips reviews"),
and/or retrieval over past messages. That work is identical in every framework.

Not designed yet. Open question in §6.

### 5.3 Durable workflows — and the trigger

Nothing built today outlives a single request, so nothing needs this yet. Three cases will need it,
and adoption should wait for the first one to actually arrive:

1. **The agent runs 日复盘 on a schedule** — no browser open, must survive a function timeout, retry
   on a model 429.
2. **A proposal that sits for hours** — AG3's one-tap accept is a human-in-the-loop interrupt:
   propose at 11pm, tap at 9am.
3. **Sharpening the Inbox** — ~23 model calls; doesn't fit one request, and item 19 failing must not
   discard the first 18.

**Candidates.** Vercel Workflow DevKit (`"use workflow"` / `"use step"`; `createHook()` suspends,
`resumeHook(token, payload)` resumes; `DurableAgent` consumes AI SDK tools directly; not installed
here). Inngest (portable, self-hostable, common on Next.js). Temporal (open source, heaviest ops).
AWS Step Functions. Or Postgres + a runs table — which is precisely what TRIAGE v1 designed and v2
killed as over-engineering, so the build-it-yourself cost is already documented.

**Portability (owner concern, unresolved).** The DevKit is the lowest-friction fit for a Next.js app
on Vercel but couples the durable runtime to Vercel. Two mitigations: AG4 keeps logic out of the
orchestrator, so swapping engines rewrites ~3 files of ordering, not the business logic; and if AWS
is a real destination rather than a hypothetical, choose Inngest at the trigger instead. Worth noting
the app is *already* deeply coupled to Neon for both database and auth — Neon Auth would be the
expensive migration, not this. **Unverified:** whether the DevKit has a self-hostable production
backend. Check before adopting.

**LangGraph** was considered and set aside: a second agent runtime beside AI SDK v7, its own state
model and checkpointer tables, and on serverless something must host the resume. Its real advantages
(explicit graph model, LangSmith tracing) don't match a loop that is one turn, ≤8 tool steps, and one
approval pause. Consistent with the original stack decision (no LangGraph).

## 6. Open questions

1. **MCP or in-app chat — which surface matters?** If the owner mostly talks to Claude, a local
   stdio MCP server exposing the §5.1 capabilities delivers the stated want ("chat to know progress,
   review history, edit, trigger workflows") without building any chat UI, and makes §4's *show*
   stage largely unnecessary. Remote MCP would need OAuth 2.1; a local stdio server needs none. If
   the app's own chat is the product, continue to *show* and *compose*. Not decided.
2. **Model and API key.** `gemini-2.0-flash` was chosen for the free tier; `DAILY_REQUEST_CAP = 250`.
   The owner has offered to supply their own key, which unlocks per-task model routing — cheap model
   for chat, strong model for sharpening and the daily review. Also the moment to fix the drift where
   PRD/TDD still describe Grok via the AI Gateway while the code runs Gemini direct.
3. **Memory design** (§5.2) — summaries vs. extracted facts vs. retrieval, and where they live.
4. **Does the daily review become agent-written?** The owner's instinct: *"the agent can still review
   them."* Keep the cadence, drop the sitting — but the shape of the output is undesigned.

## 7. Superseded and dropped

- **TRIAGE.md T1–T4** — assumed an expensive overdue pile. There were five items and they were
  cleared by pushing three and deleting two. `pushCount` may return later as a signal; the digest
  violates AG2.
- **ROUTINES.md §R3 as specified** — routine tools because a doc said so. `listRoutines` returns in
  §5.1 as a *read* block; the write tools wait until something needs them.
- **The prose INBOX REVIEW workflow** in the chat system prompt — violates AG2 (it is an
  interrogation across 23 items).
- **Any new fixed panel** above the chat.

## 8. Appendix — how the §2 numbers were produced

Read-only, against `.env.production.local`'s `DATABASE_URL`.

```sql
-- scale
select case when routine_id is not null then 'routine' else 'one-off' end kind,
       status, count(*) from tasks group by 1,2;

-- shape of active one-offs
select count(*) total,
  count(*) filter (where description is null or description='') no_desc,
  count(*) filter (where estimate is null) no_estimate,
  count(*) filter (where due_date < current_date) overdue,
  count(*) filter (where updated_at - created_at < interval '1 minute') never_touched
from tasks where status='active' and routine_id is null;

-- throughput
select date_trunc('week', completed_at)::date wk, count(*)
from tasks where status='completed' and routine_id is null
  and completed_at > now() - interval '8 weeks' group by 1 order by 1;

-- routine adherence
select r.content, count(*) filter (where t.status='completed') done,
       count(*) filter (where t.status='missed') missed
from tasks t join routines r on r.id=t.routine_id
where t.due_date >= current_date - 30 group by 1 order by 2 desc;
```

Re-run these before acting on anything above — the numbers are a snapshot, and the conclusions in §2
are only as good as the snapshot.

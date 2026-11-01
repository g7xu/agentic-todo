# Weekly reviews — Feature Spec

**Owner:** Guoxuan Xu
**Status:** v1 built
**Last updated:** 2026-11-01
Companion docs: [AGENT.md](./AGENT.md) · [ROUTINES.md](./ROUTINES.md) · [TDD.md](./design/TDD.md)

---

## 1. Summary

A weekly review (周复盘) board, one per week, in four columns:

| Column | Holds |
|---|---|
| Thorn | what stung |
| Rose | what went well |
| Seed | worth trying |
| Action | what to do next |

Beside the board, "Done this week" lists the one-off tasks completed that week. A review is a look
back at finished work, and that work already lives in this app. Closing the week turns up to three
Action notes into ordinary tasks for the following week.

The board replaces a separate app, personal-swiftboard, which had the same four columns and the
same carry-three rule. Nothing was migrated from it.

### Decisions (owner-decided 2026-11-01)

- **DR1 — The row appears with the first note.** Opening a week's board writes nothing. A week
  nobody wrote in has no `reviews` row, the same "absence is the record" rule as routine days
  (ROUTINES.md DR2).
- **DR2 — Weeks start on Sunday**, keyed by that Sunday as `YYYY-MM-DD` in the profile timezone.
  This matches `startOfWeek` and the date picker, so a review week and a calendar week are the
  same seven days.
- **DR3 — A carried action is an ordinary task.** It goes to the Inbox, planned for the next
  Sunday, and the note keeps its id in `carriedTaskId`. Done means the normal complete, and the
  task shows up in Today and Upcoming like any other. Deleting the task only clears the link.
- **DR4 — At most three carried actions.** Enforced in the data layer, the validation schema and
  the dialog. With three or fewer actions, all start ticked.
- **DR5 — A closed week is read-only.** Every note write checks the review's `closedAt`. There is
  no reopen in v1.
- **DR6 — Evidence is completed one-off tasks.** Routine days are left out: the Activity grid
  already shows them, and a week of daily routines would bury the one-offs. A task counts on the
  local day it was completed.
- **DR7 — No AI in the app.** The board is written by hand. MCP review tools can later wrap the
  same data functions (AGENT.md AG4).

## 2. Reference

| Piece | Where |
|---|---|
| Tables | `reviews` (unique per user and week), `review_notes` |
| Data functions | `src/lib/data/reviews.ts` |
| Server actions | `src/app/actions/reviews.ts` |
| Reads | `GET /api/reviews`, `GET /api/reviews/{week}` |
| Pages | `/reviews`, `/reviews/{week}` |

Account export includes reviews with their notes. Account deletion removes them.

## 3. Not built

- Reopening a closed week.
- MCP tools for reading or drafting a review.
- Routine results and pushed-task signals in the evidence panel.

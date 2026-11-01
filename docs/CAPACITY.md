# Available time per day — Feature Spec

**Owner:** Guoxuan Xu
**Status:** Draft v1
**Last updated:** 2026-10-31
Companion docs: [ESTIMATES.md](./ESTIMATES.md) · [TDD.md](./design/TDD.md)

---

## 1. Summary

Each Upcoming column shows how much working time the day has left: the time available that day,
minus the estimates of what is planned on it. Available time comes from a default set in Settings,
and any single day can override it from its column header.

This is the "capacity warning" that ESTIMATES.md §5 deferred. Estimates made a day's *load* visible;
this sets that load against the day's *budget*, so "is Thursday already full?" is answered before
dragging one more task onto it.

### Decisions

- **DC1 — Unset by default.** A new account has no default and the board looks exactly as it did:
  the `~Xh planned` total and nothing else. A made-up "8h" would put a fake budget on every column
  for someone who never asked for one — the same reasoning as ESTIMATES DE5.

- **DC2 — A per-day value replaces the default; clearing it falls back.** The override is a row per
  (user, date). Setting `0` is a real value — a day off — not "unset". Removing the row returns the
  day to the default, so changing the default later still moves every day that was never touched.

- **DC3 — Done work counts against the day.** Remaining = available − (estimates of active tasks
  and routine occurrences) − (completed tasks: `timeUsed`, else `estimate`). Excluding completed
  work would make finishing a task *free up* time, which is backwards: a 6h day with 2h done and 3h
  still planned has 1h of room, not 3h. Actual time is preferred over the estimate because that is
  what the day really spent.

- **DC4 — Still a lower bound.** Unestimated tasks contribute nothing and are counted next to the
  number, as on the existing total. "1h free · 2 unestimated" says honestly that it might be less.

- **DC5 — No clock awareness.** "Today" doesn't shrink as the hours pass; it is a budget for the
  day, not a timer. Knowing the time left would need working hours (start/end), which is the
  time-blocking question ESTIMATES DE2 already set aside.

- **DC6 — One default, not one per weekday.** Weekends usually differ, but a per-day override covers
  that without a seven-field settings form. Per-weekday defaults are the obvious v2 if overriding
  every Saturday gets tedious.

## 2. Behavior

**Column header** (every day column; the Overdue column has none, since it isn't a day):

```
Sat · Nov 1
[■■■■■■■■▨▨▨▨░░░░░░]           done ■  planned ▨  free ░
3h free of 6h · 1 unestimated
```

- Over budget: the bar fills red and the line reads `1h 30m over 6h`.
- No capacity for the day: the existing `~2h planned` total, unchanged.
- Hover shows the breakdown: `6h available (default) · 1h done · ~2h planned`.

**Setting a day.** The line is a button. It opens the same menu as the estimate picker, with
hour-sized presets (0m, 2h, 4h, 6h, 8h) and a free-text field (`5h`, `4h30`, `90`). "Use default"
removes the override. On a day with no capacity at all, the trigger reads "Set time" and appears on
hover, so an account that never uses the feature isn't cluttered by it.

**Settings → Available time.** One duration field, saved on change. Clearing it turns the feature
off for every day that has no override of its own.

**Bounds.** 0 to 24h, the same cap as an estimate.

## 3. Technical design

- **Schema.** `Profile.dailyCapacity Int?` (minutes; null = unset), and a `DayCapacity` table keyed
  by `(userId, date)` with `minutes Int`. Account deletion removes the rows; the account export
  includes them.
- **Read.** `GET /api/capacity` → `{ defaultMinutes, days: { 'YYYY-MM-DD': minutes } }`, overrides
  from today on. React Query key `['capacity']`.
- **Write.** `setDefaultCapacityAction(minutes | null)` and `setDayCapacityAction(date, minutes |
  null)` (null deletes the row). Both optimistic.
- **Math.** `dayLoad()` in `src/lib/capacity.ts` is pure and unit-tested; the board only renders its
  result.

## 4. Non-goals (v1)

- Per-weekday defaults (DC6), working hours and a shrinking "today" (DC5).
- Blocking or warning on drop. The bar turns red; the user decides.
- Exposing capacity to MCP clients. Worth doing so an agent can balance days by load, but it is a
  separate change to the tool surface.

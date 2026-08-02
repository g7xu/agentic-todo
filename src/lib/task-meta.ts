/**
 * Class strings for the metadata line under a task's title — the dates,
 * durations and project that appear on every task, in the list rows
 * (`task-row.tsx`) and on both board cards (`upcoming-board.tsx`). Shared
 * rather than copied because those three already drifted apart once.
 */

/**
 * The row itself. `flex-wrap` + `whitespace-nowrap` on the chips is the whole
 * point: without it the chips shrink and their own text breaks, so a 288px
 * column renders "Jul / 24" and "1h / 30m" stacked, which reads as two values
 * instead of one.
 */
export const META_ROW = "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs";

/** One icon+value chip. `tabular-nums` keeps dates and durations from jittering
 * as they change width between cards. */
export const META_CHIP =
  "flex shrink-0 items-center gap-0.5 whitespace-nowrap tabular-nums";

/** The project name. Contained in a chip because project names are user text —
 * a long or shouty one ("THIS MONTH") otherwise dominates the row. */
export const PROJECT_CHIP =
  "bg-muted text-muted-foreground max-w-full shrink truncate rounded px-1 py-px text-[11px]";

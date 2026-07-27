import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration, sumEstimates } from "@/lib/duration";

/**
 * A day's estimated load — the payoff that makes filling estimates in worth it
 * (docs/ESTIMATES.md §2). Without a rollup the field is write-only.
 *
 * Always a lower bound, and says so: items with no estimate contribute nothing
 * and are counted separately rather than assigned a guessed default (DE5). A
 * made-up number would make the total look complete when it isn't.
 *
 * Renders nothing when no item has an estimate — on a list nobody has estimated,
 * a bare "0m · 4 unestimated" is noise.
 */
export function PlannedTotal({
  items,
  className,
}: {
  items: { estimate: number | null }[];
  className?: string;
}) {
  const total = sumEstimates(items);
  if (total === 0) return null;

  const unestimated = items.filter((i) => i.estimate === null).length;
  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      title={
        unestimated > 0
          ? unestimated === 1
            ? "1 task has no estimate and isn't counted"
            : `${unestimated} tasks have no estimate and aren't counted`
          : undefined
      }
    >
      <Clock className="size-3" />~{formatDuration(total)} planned
      {unestimated > 0 && ` · ${unestimated} unestimated`}
    </span>
  );
}

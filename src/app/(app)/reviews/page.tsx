"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { NOTE_KINDS, weekLabel } from "@/lib/reviews";
import { useReviews } from "@/hooks/use-reviews";
import { KIND_META } from "@/components/views/review-board";
import type { ReviewSummaryDTO } from "@/lib/types";

function Row({ week, summary, current }: { week: string; summary?: ReviewSummaryDTO; current: boolean }) {
  return (
    <Link
      href={`/reviews/${week}`}
      className="hover:bg-accent/40 flex items-center gap-3 border-b px-3 py-2.5 text-sm last:border-b-0"
    >
      <span className="w-36 shrink-0 font-medium">
        {weekLabel(week)}
        {current && <span className="text-muted-foreground font-normal"> · this week</span>}
      </span>
      <span className="text-muted-foreground flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1 text-xs">
        {summary
          ? NOTE_KINDS.filter((k) => summary.counts[k] > 0).map((k) => (
              <span key={k} className="flex items-center gap-1 tabular-nums">
                <span className={cn("size-1.5 rounded-full", KIND_META[k].dot)} aria-hidden />
                {summary.counts[k]} {KIND_META[k].label.toLowerCase()}
              </span>
            ))
          : "Not started"}
      </span>
      <span className="text-muted-foreground shrink-0 text-xs">
        {summary ? (summary.closedAt ? "Closed" : "Open") : ""}
      </span>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </Link>
  );
}

export default function ReviewsPage() {
  const { data, isLoading, isError, refetch } = useReviews();
  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Reviews</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Look back at the week: what stung, what went well, what to try, and up to three
        actions to carry forward.
      </p>
      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : isError || !data ? (
        <p className="text-sm">
          <span className="text-red-600">Couldn’t load reviews.</span>{" "}
          <button className="underline" onClick={() => refetch()}>
            Retry
          </button>
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Row
            week={data.thisWeek}
            summary={data.reviews.find((r) => r.weekStart === data.thisWeek)}
            current
          />
          {data.reviews
            .filter((r) => r.weekStart !== data.thisWeek)
            .map((r) => (
              <Row key={r.weekStart} week={r.weekStart} summary={r} current={false} />
            ))}
        </div>
      )}
    </div>
  );
}

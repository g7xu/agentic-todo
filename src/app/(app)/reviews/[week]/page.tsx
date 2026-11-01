"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ReviewBoard } from "@/components/views/review-board";
import { isWeekStart } from "@/lib/reviews";
import { dateStr } from "@/lib/validation/tasks";

export default function ReviewWeekPage() {
  const { week } = useParams<{ week: string }>();
  if (!dateStr.safeParse(week).success || !isWeekStart(week)) {
    return (
      <p className="p-6 text-sm">
        That isn’t the start of a review week.{" "}
        <Link href="/reviews" className="underline">
          See all reviews
        </Link>
      </p>
    );
  }
  return <ReviewBoard key={week} week={week} />;
}

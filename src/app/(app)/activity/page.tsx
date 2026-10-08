"use client";

import { ActivityGrid } from "@/components/views/activity-grid";

export default function ActivityPage() {
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Activity</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        What each routine actually did, day by day.
      </p>
      <ActivityGrid />
    </div>
  );
}

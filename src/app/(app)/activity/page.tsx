"use client";

import { ActivityGrid } from "@/components/views/activity-grid";
import { TimeByProject } from "@/components/views/time-by-project";

export default function ActivityPage() {
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Activity</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Where finished work went, and what each routine did day by day.
      </p>
      <section className="mb-8">
        <h2 className="mb-3 text-base font-medium">Time by project</h2>
        <TimeByProject />
      </section>
      <section>
        <h2 className="mb-3 text-base font-medium">Routines</h2>
        <ActivityGrid />
      </section>
    </div>
  );
}

"use client";

import { ActivityGrid } from "@/components/views/activity-grid";
import { EstimateVsActual } from "@/components/views/estimate-vs-actual";

export default function ActivityPage() {
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Activity</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        How long finished work took against its estimate, and what each routine did day by day.
      </p>
      <section className="mb-8">
        <h2 className="mb-3 text-base font-medium">Estimate vs. actual</h2>
        <EstimateVsActual />
      </section>
      <section>
        <h2 className="mb-3 text-base font-medium">Routines</h2>
        <ActivityGrid />
      </section>
    </div>
  );
}

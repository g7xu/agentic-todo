"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TASKS_KEY } from "@/hooks/use-tasks";

type PlanItem = {
  taskId: string;
  content: string;
  fromDate: string;
  toDate: string;
  reason: string;
  note?: string;
};
type ApplySummary = {
  applied: { taskId: string; toDate: string }[];
  skipped: { taskId: string; reason: string }[];
};
type Phase = "idle" | "loading" | "plan" | "applying" | "done" | "error";

/**
 * End-of-day review (PRD F7 / TDD §6.3). A dedicated flow — NOT part of the
 * useChat message stream — with its own state: propose → editable plan →
 * confirm → apply (transactional) → summary.
 */
export function ReviewPanel() {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [summary, setSummary] = useState<ApplySummary | "empty" | null>(null);
  const [error, setError] = useState("");

  async function propose() {
    setPhase("loading");
    setError("");
    setSummary(null);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "propose" }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error || "Could not generate a review. Please try again.");
        setPhase("error");
        return;
      }
      const data = await res.json();
      if (data.empty) {
        setSummary("empty");
        setPhase("done");
        return;
      }
      setPlan(data.plan);
      setPhase("plan");
    } catch {
      setError("Could not generate a review. Please try again.");
      setPhase("error");
    }
  }

  async function apply() {
    setPhase("applying");
    setError("");
    try {
      const items = plan.map((p) => ({
        taskId: p.taskId,
        fromDate: p.fromDate,
        toDate: p.toDate,
      }));
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "apply", items }),
      });
      if (!res.ok) throw new Error();
      setSummary(await res.json());
      setPhase("done");
      queryClient.invalidateQueries({ queryKey: TASKS_KEY });
    } catch {
      setError("Could not apply the plan. Please try again.");
      setPhase("error");
    }
  }

  function setToDate(taskId: string, toDate: string) {
    setPlan((p) => p.map((x) => (x.taskId === taskId ? { ...x, toDate } : x)));
  }

  return (
    <div className="border-b p-3">
      {(phase === "idle" || phase === "done" || phase === "error") && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={propose}
        >
          <CalendarCheck className="size-4" /> Review my day
        </Button>
      )}

      {phase === "loading" && (
        <p className="text-muted-foreground text-sm">Planning your day…</p>
      )}
      {phase === "applying" && (
        <p className="text-muted-foreground text-sm">Applying…</p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {phase === "plan" && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Proposed reschedule</p>
          {plan.map((p) => (
            <div key={p.taskId} className="rounded border p-2 text-xs">
              <div className="font-medium">{p.content}</div>
              <div className="text-muted-foreground flex items-center gap-1">
                <span>{p.fromDate} →</span>
                <input
                  type="date"
                  value={p.toDate}
                  onChange={(e) => setToDate(p.taskId, e.target.value)}
                  className="rounded border bg-transparent px-1 py-0.5"
                />
              </div>
              <div className="text-muted-foreground mt-0.5 italic">
                {p.reason}
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" onClick={apply}>
              Apply
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPhase("idle");
                setPlan([]);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {phase === "done" && summary === "empty" && (
        <p className="text-muted-foreground mt-2 text-sm">
          Nothing to review — you&apos;re all caught up. 🎉
        </p>
      )}
      {phase === "done" && summary && summary !== "empty" && (
        <div className="mt-2 text-xs">
          <p className="font-medium">
            Applied {summary.applied.length}, skipped {summary.skipped.length}.
          </p>
          {summary.skipped.length > 0 && (
            <ul className="text-muted-foreground list-disc pl-4">
              {summary.skipped.map((s) => (
                <li key={s.taskId}>skipped ({s.reason})</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

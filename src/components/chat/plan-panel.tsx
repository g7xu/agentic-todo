"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ListTodo, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TASKS_KEY } from "@/hooks/use-tasks";

type PlanItem = { title: string; priority?: number; note?: string };
type Phase = "idle" | "composing" | "loading" | "plan" | "applying" | "error";

/**
 * Plan mode (Capture → Plan → Execute): decompose a messy brain-dump into atomic
 * tasks, let the user vet/edit the plan, create them, then auto-chain into Review
 * Inbox (via onCreated) to coach each into a concrete task.
 */
export function PlanPanel({ onCreated }: { onCreated: () => void }) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [items, setItems] = useState<PlanItem[]>([]);
  const [error, setError] = useState("");

  function reset() {
    setPhase("idle");
    setText("");
    setItems([]);
    setError("");
  }

  async function propose() {
    const t = text.trim();
    if (!t) return;
    setPhase("loading");
    setError("");
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "propose", text: t }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error || "Could not plan those tasks. Please try again.");
        setPhase("error");
        return;
      }
      const data = (await res.json()) as { tasks: PlanItem[] };
      if (!data.tasks?.length) {
        setError("I couldn't find any tasks in that. Try rephrasing.");
        setPhase("error");
        return;
      }
      setItems(data.tasks);
      setPhase("plan");
    } catch {
      setError("Could not plan those tasks. Please try again.");
      setPhase("error");
    }
  }

  async function apply() {
    setPhase("applying");
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "apply", items }),
      });
      if (!res.ok) throw new Error();
      await res.json();
      queryClient.invalidateQueries({ queryKey: TASKS_KEY });
      reset();
      onCreated(); // auto-chain into Review Inbox
    } catch {
      setError("Could not create the tasks. Please try again.");
      setPhase("error");
    }
  }

  return (
    <div className="border-b p-3">
      {(phase === "idle" || phase === "error") && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setPhase("composing")}
        >
          <ListTodo className="size-4" /> Plan tasks from a brain-dump
        </Button>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {phase === "composing" && (
        <div className="space-y-2">
          <textarea
            autoFocus
            value={text}
            rows={4}
            placeholder="Dump everything on your mind… I'll split it into tasks."
            className="border-input w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={propose} disabled={!text.trim()}>
              Plan
            </Button>
            <Button size="sm" variant="outline" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {phase === "loading" && (
        <p className="text-muted-foreground text-sm">Planning your tasks…</p>
      )}
      {phase === "applying" && (
        <p className="text-muted-foreground text-sm">Creating tasks…</p>
      )}

      {phase === "plan" && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{items.length} tasks — edit or remove, then create</p>
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {it.priority && it.priority < 4 && (
                <span className="text-muted-foreground text-xs">p{it.priority}</span>
              )}
              <input
                value={it.title}
                onChange={(e) =>
                  setItems((p) =>
                    p.map((x, idx) =>
                      idx === i ? { ...x, title: e.target.value } : x,
                    ),
                  )
                }
                className="border-input flex-1 rounded border bg-transparent px-2 py-1 text-xs"
              />
              <button
                aria-label="Remove"
                className="hover:bg-accent rounded p-1"
                onClick={() =>
                  setItems((p) => p.filter((_, idx) => idx !== i))
                }
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" onClick={apply} disabled={items.length === 0}>
              Create {items.length} tasks
            </Button>
            <Button size="sm" variant="outline" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

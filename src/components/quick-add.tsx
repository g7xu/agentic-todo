"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useCreateTask } from "@/hooks/use-tasks";

/**
 * Quick-add input with contextual defaults (TDD §5 / PRD F2): the caller passes
 * the view's default due date and project so the new task lands in the view it
 * was added from. Pass `shortcut` on single-input views to let "/" focus it.
 */
export function QuickAdd({
  defaultDueDate = null,
  defaultProjectId = null,
  placeholder = "Add a task…",
  shortcut = false,
}: {
  defaultDueDate?: string | null;
  defaultProjectId?: string | null;
  placeholder?: string;
  shortcut?: boolean;
}) {
  const create = useCreateTask();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!shortcut) return;
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el as HTMLElement | null)?.isContentEditable;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);

  function submit() {
    const content = value.trim();
    if (!content) return;
    create.mutate({
      content,
      dueDate: defaultDueDate,
      projectId: defaultProjectId,
    });
    setValue("");
  }

  return (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <Plus className="text-muted-foreground size-4 shrink-0" />
      <Input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  Flag,
  Hash,
  Inbox,
  Plus,
  SendHorizontal,
  Target,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { insertNewlineAtCursor } from "@/lib/textarea";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DurationPicker } from "@/components/duration-picker";
import { useTimezone } from "@/components/timezone-context";
import { addDays, todayStr } from "@/lib/date";
import { useCreateTask } from "@/hooks/use-tasks";
import { useProjects } from "@/hooks/use-projects";

const PRIORITIES = [
  { value: 1, label: "Priority 1", color: "text-red-500" },
  { value: 2, label: "Priority 2", color: "text-orange-500" },
  { value: 3, label: "Priority 3", color: "text-blue-500" },
  { value: 4, label: "Priority 4", color: "text-muted-foreground" },
] as const;

function dueLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function dueColor(date: string, today: string): string {
  if (date === today) return "text-green-600";
  if (date === addDays(today, 1)) return "text-amber-600";
  return "text-foreground";
}

/**
 * Quick-add task composer (TDD §5 / PRD F2). Collapsed it is a one-line
 * "+ Add a task…" row; clicking it (or "/" when `shortcut` is set) expands a
 * Todoist-style card with name, description, due date, priority, and project.
 * The caller passes the view's default due date / project so the new task
 * lands in the view it was added from.
 */
export function QuickAdd({
  defaultDueDate = null,
  defaultProjectId = null,
  placeholder = "Add a task…",
  shortcut = false,
  className,
  expandOverlay = false,
}: {
  defaultDueDate?: string | null;
  defaultProjectId?: string | null;
  placeholder?: string;
  shortcut?: boolean;
  className?: string;
  /**
   * Render the expanded card as an absolute overlay growing downward from the
   * collapsed row instead of in the layout flow. Used by the Upcoming board so
   * expanding the composer doesn't stretch the day columns.
   */
  expandOverlay?: boolean;
}) {
  const create = useCreateTask();
  const tz = useTimezone();
  const today = todayStr(tz);
  const { data: projects = [] } = useProjects();

  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState<string | null>(defaultDueDate);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [priority, setPriority] = useState<number>(4);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId);
  const nameRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  // Overlay mode: position the expanded card in a fixed layer anchored to the
  // collapsed row, clamped to the viewport, so it escapes the board's overflow
  // clipping. Clamping shifts the card up when the anchor sits near the bottom
  // of the screen (e.g. the quick-add pinned under a full column).
  const updateRect = useCallback(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = r.width;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    // Card height is 0 on the first pass (not rendered yet); the effect below
    // re-clamps once it's measurable.
    const cardH = cardRef.current?.offsetHeight ?? 0;
    const top = Math.max(8, Math.min(r.top, window.innerHeight - cardH - 8));
    setRect((prev) =>
      prev && prev.top === top && prev.left === left && prev.width === width
        ? prev
        : { top, left, width },
    );
  }, []);

  useLayoutEffect(() => {
    if (expanded && expandOverlay) updateRect();
  }, [expanded, expandOverlay, updateRect]);

  // Second pass after the card mounts: re-clamp with its real height. The
  // equality guard in updateRect keeps this from looping.
  useLayoutEffect(() => {
    if (rect) updateRect();
  }, [rect, updateRect]);

  const inbox = projects.find((p) => p.isInbox);
  const selectedProject =
    projects.find((p) => p.id === projectId) ?? inbox ?? null;

  useEffect(() => {
    if (expanded) nameRef.current?.focus();
  }, [expanded]);

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
        setExpanded(true);
        nameRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);

  function reset() {
    setContent("");
    setDescription("");
    setDueDate(defaultDueDate);
    setDeadline(null);
    setPriority(4);
    setEstimate(null);
    setProjectId(defaultProjectId);
  }

  function close() {
    reset();
    setExpanded(false);
  }

  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!(expanded && expandOverlay)) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (cardRef.current?.contains(target)) return;
      // Keep the composer open while interacting with its portaled dropdowns.
      if (
        target.closest(
          '[data-radix-popper-content-wrapper], [data-slot="dropdown-menu-content"]',
        )
      )
        return;
      closeRef.current();
    }
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [expanded, expandOverlay, updateRect]);

  function submit() {
    const trimmed = content.trim();
    if (!trimmed) return;
    create.mutate({
      content: trimmed,
      description: description.trim() || null,
      priority,
      dueDate,
      deadline,
      estimate,
      projectId: selectedProject?.id ?? null,
    });
    // Keep the composer open (and the date/priority/estimate/project choices) so
    // several tasks can be entered in a row, like Todoist. The estimate persists
    // with the rest: tasks entered in a burst tend to be the same rough size.
    // The DEADLINE deliberately does NOT persist — it's the most task-specific
    // field, and silently stamping the previous task's hard date onto the next
    // capture is worse than re-entering it.
    setContent("");
    setDescription("");
    setDeadline(null);
    nameRef.current?.focus();
  }

  const collapsedRow = (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      className={cn(
        "text-muted-foreground hover:text-foreground flex w-full items-center gap-2 border-b px-3 py-2 text-sm",
        className,
      )}
    >
      <Plus className="size-4 shrink-0" />
      {placeholder}
    </button>
  );

  if (!expanded) return collapsedRow;

  const priorityMeta = PRIORITIES.find((p) => p.value === priority)!;

  const card = (
    <div
      className="bg-card rounded-lg border shadow-sm"
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <div className="flex flex-col gap-1 p-3">
        <input
          ref={nameRef}
          value={content}
          placeholder="Task name"
          className="placeholder:text-muted-foreground w-full bg-transparent text-base font-medium outline-none"
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        {/* Enter submits; Cmd/Ctrl+Enter inserts a newline (Shift+Enter keeps
            the textarea's native newline). Grows with its content. */}
        <textarea
          value={description}
          placeholder="Description"
          rows={1}
          className="placeholder:text-muted-foreground field-sizing-content max-h-32 w-full resize-none bg-transparent text-sm outline-none"
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            if (e.metaKey || e.ctrlKey) {
              e.preventDefault();
              insertNewlineAtCursor(e.currentTarget, setDescription);
            } else if (!e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Due date chip */}
          <div className="flex h-8 items-center rounded-md border">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex h-full items-center gap-1.5 px-2 text-sm",
                    dueDate ? dueColor(dueDate, today) : "text-muted-foreground",
                  )}
                >
                  <CalendarDays className="size-4" />
                  {dueDate ? dueLabel(dueDate, today) : "Date"}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => setDueDate(today)}>
                  Today
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDueDate(addDays(today, 1))}>
                  Tomorrow
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDueDate(addDays(today, 7))}>
                  Next week
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <div
                  className="px-2 py-1.5"
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <input
                    type="date"
                    className="bg-transparent text-sm outline-none"
                    value={dueDate ?? ""}
                    onChange={(e) => setDueDate(e.target.value || null)}
                  />
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            {dueDate && (
              <button
                type="button"
                aria-label="Clear due date"
                className="text-muted-foreground hover:text-foreground h-full border-l px-1.5"
                onClick={() => setDueDate(null)}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Deadline chip — the HARD date, distinct from the planned date
              (docs/DEADLINES.md). Same chip anatomy as Date: presets above a
              raw input, keydown stopped so the menu typeahead doesn't eat it,
              clear-X as a sibling outside the trigger. */}
          <div className="flex h-8 items-center rounded-md border">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex h-full items-center gap-1.5 px-2 text-sm",
                    deadline ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <Target className="size-4" />
                  {deadline ? dueLabel(deadline, today) : "Deadline"}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => setDeadline(addDays(today, 1))}>
                  Tomorrow
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDeadline(addDays(today, 7))}>
                  In a week
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <div
                  className="px-2 py-1.5"
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <input
                    type="date"
                    className="bg-transparent text-sm outline-none"
                    value={deadline ?? ""}
                    onChange={(e) => setDeadline(e.target.value || null)}
                  />
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            {deadline && (
              <button
                type="button"
                aria-label="Clear deadline"
                className="text-muted-foreground hover:text-foreground h-full border-l px-1.5"
                onClick={() => setDeadline(null)}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Priority */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-md border px-2 text-sm",
                  priority < 4 ? priorityMeta.color : "text-muted-foreground",
                )}
              >
                <Flag className="size-4" />
                {priority < 4 ? `P${priority}` : "Priority"}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {PRIORITIES.map((p) => (
                <DropdownMenuItem key={p.value} onSelect={() => setPriority(p.value)}>
                  <Flag className={cn("size-4", p.color)} />
                  {p.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Estimate */}
          <DurationPicker value={estimate} onChange={setEstimate} />
        </div>
      </div>

      <div className="flex items-center justify-between border-t px-3 py-2">
        {/* Project picker */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm"
            >
              {selectedProject && !selectedProject.isInbox ? (
                <Hash className="size-4" />
              ) : (
                <Inbox className="size-4" />
              )}
              {selectedProject?.name ?? "Inbox"}
              <ChevronDown className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {projects.map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => setProjectId(p.id)}>
                {p.isInbox ? (
                  <Inbox className="size-4" />
                ) : (
                  <Hash className="size-4" />
                )}
                {p.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="Cancel"
            onClick={close}
          >
            <X className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            aria-label="Add task"
            disabled={!content.trim() || create.isPending}
            onClick={submit}
          >
            <SendHorizontal className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );

  if (!expandOverlay) return card;

  // The invisible collapsed row keeps the surrounding layout at its collapsed
  // size; the card renders in a fixed layer anchored to it, clamped to the
  // viewport and unaffected by the board's overflow clipping.
  return (
    <div ref={anchorRef}>
      <div className="invisible" aria-hidden>
        {collapsedRow}
      </div>
      {rect && (
        <div
          ref={cardRef}
          className="fixed z-50"
          style={{ top: rect.top, left: rect.left, width: rect.width }}
        >
          {card}
        </div>
      )}
    </div>
  );
}

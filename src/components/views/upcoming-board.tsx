"use client";

import { useMemo, useRef, useState } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Check,
  ChevronRight,
  Clock,
  Hourglass,
  MoreHorizontal,
  Pencil,
  Repeat,
  Target,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { addDays } from "@/lib/date";
import { formatDuration } from "@/lib/duration";
import { PlannedTotal } from "@/components/planned-total";
import { QuickAdd } from "@/components/quick-add";
import {
  useCompleteTask,
  useDeleteTask,
  useMoveTask,
  useTasks,
  useUncompleteTask,
} from "@/hooks/use-tasks";
import { useProjects } from "@/hooks/use-projects";
import { useCompleteRoutineOccurrence, useRoutines } from "@/hooks/use-routines";
import { useToday } from "@/hooks/use-today";
import { cadenceLabel, isDueOn, occurrencesBetween } from "@/lib/repeat";
import { META_CHIP, META_ROW, PROJECT_CHIP } from "@/lib/task-meta";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditTaskDialog } from "@/components/edit-task-dialog";
import type { ProjectDTO, RoutineDTO, TaskDTO } from "@/lib/types";

/** Check-circle tint per priority — replaces the old flag while keeping the
 * priority visible, Todoist-style. The `!` on border colors is required:
 * @neondatabase/auth-ui ships a `neon-auth` CSS layer with a universal
 * `* { border-color: var(--neon-border) }` rule that outranks the Tailwind
 * utilities layer. */
const PRIORITY_CIRCLE: Record<number, string> = {
  1: "border-red-500! text-red-500",
  2: "border-orange-500! text-orange-500",
  3: "border-blue-500! text-blue-500",
  4: "border-muted-foreground/50! text-muted-foreground",
};

/**
 * The routine look. Teal is the hue the Activity grid uses for a routine day
 * done, so a routine reads as the same thing on both pages. Borders need the
 * `!` for the reason given on PRIORITY_CIRCLE.
 *
 * Three states share the hue and differ in weight: a day that is due TODAY is
 * solid and filled, a day still AHEAD is dashed and unfilled, and a day already
 * RECORDED keeps only the border.
 */
const ROUTINE_TODAY =
  "border-teal-600/50! bg-teal-500/10 dark:border-teal-400/50!";
const ROUTINE_PREVIEW =
  "border-dashed border-teal-600/35! bg-transparent dark:border-teal-400/35!";
const ROUTINE_RECORDED = "border-teal-600/35! dark:border-teal-400/35!";
const ROUTINE_INK = "text-teal-700 dark:text-teal-300";

type Items = Record<string, string[]>;

/** One routine occurrence to draw in a day column. */
type RoutineCardItem = { routine: RoutineDTO; variant: "today" | "preview" };

/** Pseudo-column key for active tasks whose due date has passed. */
const OVERDUE = "overdue";

/** Stamped on every drag end/cancel. The browser fires a trailing `click`
 * after a drop; when the card re-mounted in a new column its local press
 * position is gone, so this shared stamp is what suppresses that click. */
let lastDragEndAt = 0;

/** Short "Jul 4"-style label for the red due-date shown on overdue cards. */
function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function columnLabel(date: string, today: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const diff = Math.round(
    (d.getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000,
  );
  const weekday = d.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
  const md = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  if (diff === 0) return `Today · ${md}`;
  if (diff === 1) return `Tomorrow · ${md}`;
  return `${weekday} · ${md}`;
}

function TaskCard({
  task,
  projects,
  dragging = false,
  showDue = false,
}: {
  task: TaskDTO;
  projects: ProjectDTO[];
  dragging?: boolean;
  /** Show the task's own due date (red) — used in the Overdue column. */
  showDue?: boolean;
}) {
  const complete = useCompleteTask();
  const uncomplete = useUncompleteTask();
  const del = useDeleteTask();
  const [editing, setEditing] = useState(false);
  const today = useToday();

  const project = projects.find((p) => p.id === task.projectId);
  const isTemp = task.id.startsWith("temp-");
  const isCompleted = task.status === "completed";
  const isRoutine = task.routineId !== null;
  // Deadline states, mirrored from task-row: red = hard date arrived/passed;
  // amber = planned date lands after the deadline.
  const deadlineHit =
    !isCompleted && task.deadline !== null && task.deadline <= today;
  const planPastDeadline =
    !isCompleted &&
    task.deadline !== null &&
    task.dueDate !== null &&
    task.dueDate > task.deadline;

  // Click-to-edit that coexists with drag: a press that travels further than
  // the drag activation distance (5px) was a drag, not a click — the browser
  // still fires `click` on drop, so distance is the only reliable signal.
  const pressPos = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      className={cn(
        "bg-card group flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm shadow-sm",
        dragging && "ring-primary/40 ring-2",
        isCompleted && "opacity-70",
        isRoutine && ROUTINE_RECORDED,
      )}
      onPointerDown={(e) => {
        pressPos.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e) => {
        if (isTemp || dragging) return;
        if (Date.now() - lastDragEndAt < 300) return; // trailing post-drop click
        // Portal clicks (edit dialog, dropdown menu) bubble through the React
        // tree but aren't physically inside the card — ignore them.
        if (!e.currentTarget.contains(e.target as Node)) return;
        const p = pressPos.current;
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) >= 5) return;
        setEditing(true);
      }}
    >
      <button
        type="button"
        disabled={isTemp}
        aria-label={isCompleted ? "Mark active" : "Complete task"}
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2",
          PRIORITY_CIRCLE[task.priority],
        )}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation(); // completing a task must not open the editor
          if (isCompleted) uncomplete.mutate(task.id);
          else complete.mutate(task.id);
        }}
      >
        {isCompleted && <Check className="size-3" strokeWidth={3} />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* Two lines, then clip. A card is a glance surface, but a one-line
            truncation cuts most real titles mid-word ("Stanford Final
            transcript C…"), which is worse than a taller card. */}
        <span
          className={cn(
            "line-clamp-2 leading-snug wrap-break-word",
            isCompleted && "text-muted-foreground line-through",
          )}
        >
          {task.content}
        </span>
        {task.description && (
          <span
            className={cn(
              "text-muted-foreground line-clamp-1 text-xs wrap-break-word",
              isCompleted && "line-through",
            )}
          >
            {task.description}
          </span>
        )}
        {(showDue && task.dueDate) ||
        isRoutine ||
        task.deadline !== null ||
        task.estimate !== null ||
        task.timeUsed !== null ||
        (project && !project.isInbox) ? (
          <div className={META_ROW}>
            {isRoutine && (
              <span className={cn(META_CHIP, ROUTINE_INK)} title="Routine">
                <Repeat className="size-3" />
              </span>
            )}
            {showDue && task.dueDate && (
              <span className={cn(META_CHIP, "text-red-500")}>
                {shortDate(task.dueDate)}
              </span>
            )}
            {task.deadline !== null && (
              <span
                className={cn(
                  META_CHIP,
                  deadlineHit
                    ? "text-red-500"
                    : planPastDeadline
                      ? "text-amber-600"
                      : "text-muted-foreground",
                )}
                title={
                  planPastDeadline
                    ? "Planned date is after the deadline"
                    : "Deadline"
                }
              >
                <Target className="size-3" />
                {shortDate(task.deadline)}
              </span>
            )}
            {task.estimate !== null && (
              <span
                className={cn(META_CHIP, "text-muted-foreground")}
                title="Estimated"
              >
                <Clock className="size-3" />
                {formatDuration(task.estimate)}
              </span>
            )}
            {task.timeUsed !== null && (
              <span
                className={cn(META_CHIP, "text-muted-foreground")}
                title="Time used"
              >
                <Hourglass className="size-3" />
                {formatDuration(task.timeUsed)}
              </span>
            )}
            {project && !project.isInbox && (
              <span className={PROJECT_CHIP}># {project.name}</span>
            )}
          </div>
        ) : null}
      </div>
      {!isTemp && !dragging && (
        <div className="ml-auto shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Task options"
              className="hover:bg-accent rounded p-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => del.mutate(task.id)}
              >
                <Trash2 className="size-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {editing && !isTemp && (
        <EditTaskDialog
          task={task}
          projects={projects}
          open={editing}
          onOpenChange={setEditing}
        />
      )}
    </div>
  );
}

function SortableTask({
  task,
  projects,
  showDue = false,
}: {
  task: TaskDTO;
  projects: ProjectDTO[];
  showDue?: boolean;
}) {
  const dragDisabled = task.id.startsWith("temp-");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, disabled: dragDisabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        dragDisabled ? "cursor-pointer" : "cursor-grab",
        "touch-none",
        isDragging && "opacity-40",
      )}
      {...attributes}
      {...listeners}
      onPointerDown={(e) => {
        // The edit dialog is portaled but renders inside this component tree,
        // so its pointer events BUBBLE here in React and would arm the drag
        // sensor — press a non-interactive spot in the dialog, drift 5px, and
        // the card behind it gets dragged (closing the dialog unsaved and
        // rescheduling the task on drop). Same physical-containment guard as
        // TaskCard's click-to-edit: only presses actually inside the card may
        // start a drag.
        if (!e.currentTarget.contains(e.target as Node)) return;
        listeners?.onPointerDown?.(e);
      }}
    >
      <TaskCard task={task} projects={projects} showDue={showDue} />
    </div>
  );
}

/**
 * One routine occurrence, drawn from the cadence. No task row stands behind it
 * until it is ticked, which is why there is nothing to open or edit, and why
 * it sits outside the sortable list: it has no stored date to drag.
 *
 * Ticking records the occurrence as done on its own date. On a `preview` card
 * that completes the day ahead of time (docs/ROUTINES.md §RV6).
 */
function RoutineCard({
  routine,
  date,
  variant,
  projects,
}: RoutineCardItem & { date: string; projects: ProjectDTO[] }) {
  const complete = useCompleteRoutineOccurrence();
  const project = projects.find((p) => p.id === routine.projectId);
  const isToday = variant === "today";
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border p-2 text-sm",
        isToday ? ROUTINE_TODAY : ROUTINE_PREVIEW,
      )}
      title={
        isToday ? undefined : "Scheduled — tick to complete it ahead of time"
      }
    >
      <button
        type="button"
        disabled={complete.isPending}
        aria-label={
          isToday
            ? `Complete "${routine.content}"`
            : `Complete "${routine.content}" ahead of time`
        }
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 disabled:opacity-40",
          !isToday && "border-dashed",
          PRIORITY_CIRCLE[routine.priority],
        )}
        onClick={() => complete.mutate({ routine, date })}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "line-clamp-2 leading-snug wrap-break-word",
            !isToday && "text-muted-foreground",
          )}
        >
          {routine.content}
        </span>
        <div
          className={cn(
            META_ROW,
            isToday ? ROUTINE_INK : "text-muted-foreground/70",
          )}
        >
          {/* The cadence is user-shaped text ("Every 2 weeks on Mon, Wed ·
              until Jul 20"), so unlike the other chips it may shrink and clip. */}
          <span className="flex min-w-0 items-center gap-0.5">
            <Repeat className="size-3 shrink-0" />
            <span className="truncate">{cadenceLabel(routine)}</span>
          </span>
          {routine.estimate !== null && (
            <span className={META_CHIP} title="Estimated">
              <Clock className="size-3" />
              {formatDuration(routine.estimate)}
            </span>
          )}
          {project && !project.isInbox && (
            <span className={PROJECT_CHIP}># {project.name}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Column({
  date,
  label,
  ids,
  completedIds,
  routineCards,
  taskById,
  projects,
}: {
  date: string;
  label: string;
  ids: string[];
  completedIds: string[];
  routineCards: RoutineCardItem[];
  taskById: Map<string, TaskDTO>;
  projects: ProjectDTO[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  const [showCompleted, setShowCompleted] = useState(false);
  const isOverdue = date === OVERDUE;
  // Routine cards count: an occurrence with no row is still work this day
  // will ask for. Completed tasks don't — "planned" is about what's left.
  const planned = [
    ...ids.map((id) => taskById.get(id)).filter((t) => t !== undefined),
    ...routineCards.map((c) => c.routine),
  ];
  return (
    <div className="flex max-h-full w-72 shrink-0 flex-col">
      {/* Label over total, not side by side: at this width the pair can't share
          a line, and the wrapped total used to spill across the next column. */}
      <div className="flex flex-col items-start gap-0.5 px-1 pb-2">
        <span className={cn("text-sm font-medium", isOverdue && "text-red-500")}>
          {label}
        </span>
        <PlannedTotal
          items={planned}
          className="text-muted-foreground text-xs font-normal"
        />
      </div>
      {/* The box hugs its content (columns are `items-start` in the board
          row) but never exceeds the board height (`max-h-full` on the column
          wrapper). The task list scrolls internally so the quick-add footer
          below it stays visible no matter how many tasks a day has. */}
      <div
        ref={setNodeRef}
        className={cn(
          "bg-muted/30 flex min-h-24 flex-col overflow-hidden rounded-lg border",
          isOver && !isOverdue && "ring-primary/40 ring-2",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {ids.map((id) => {
              const task = taskById.get(id);
              return task ? (
                <SortableTask
                  key={id}
                  task={task}
                  projects={projects}
                  showDue={isOverdue}
                />
              ) : null;
            })}
          </SortableContext>
          {/* Routine cards sit under the tasks, outside SortableContext, so a
              drag can neither move one nor drop between them. */}
          {routineCards.map(({ routine, variant }) => (
            <RoutineCard
              key={routine.id}
              routine={routine}
              variant={variant}
              date={date}
              projects={projects}
            />
          ))}
          {/* Completed tasks stay in their day column, crossed out at the
              bottom, but folded away behind a count — a busy day's done pile
              would otherwise bury the work that's left. Plain cards (no
              useSortable) so they can't be dragged. */}
          {completedIds.length > 0 && (
            <>
              <button
                type="button"
                aria-expanded={showCompleted}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 px-1 text-xs"
                onClick={() => setShowCompleted((s) => !s)}
              >
                <ChevronRight
                  className={cn(
                    "size-3 transition-transform",
                    showCompleted && "rotate-90",
                  )}
                />
                {completedIds.length} completed
              </button>
              {showCompleted &&
                completedIds.map((id) => {
                  const task = taskById.get(id);
                  return task ? (
                    <TaskCard key={id} task={task} projects={projects} />
                  ) : null;
                })}
            </>
          )}
        </div>
        {/* No quick-add in Overdue — new tasks can't be created "overdue". */}
        {!isOverdue && (
          <div className="shrink-0 p-2 pt-0">
            <QuickAdd
              defaultDueDate={date}
              placeholder="Add a task…"
              expandOverlay
              className="bg-card hover:bg-accent/50 rounded-md border px-2 py-0.5 transition-colors"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function UpcomingBoard() {
  const today = useToday();
  const { data: tasks = [] } = useTasks();
  const { data: projects = [] } = useProjects();
  const { data: routines = [] } = useRoutines();
  const move = useMoveTask();

  const [horizon, setHorizon] = useState(7);
  const [items, setItems] = useState<Items>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const dates = useMemo(
    () => Array.from({ length: horizon }, (_, i) => addDays(today, i)),
    [today, horizon],
  );

  const taskById = useMemo(() => {
    const m = new Map<string, TaskDTO>();
    for (const t of tasks) m.set(t.id, t);
    return m;
  }, [tasks]);

  // Columns derived from the server cache. Ranked by priority first (P1 on
  // top); `order` only breaks ties within the same priority band. Active
  // tasks whose due date has passed collect in the Overdue pseudo-column
  // (sorted oldest due date first within a priority).
  const serverItems = useMemo<Items>(() => {
    const cols: Items = {
      [OVERDUE]: [],
      ...Object.fromEntries(dates.map((d) => [d, []])),
    };
    const active = tasks
      .filter(
        (t) =>
          t.status === "active" &&
          t.dueDate !== null &&
          (t.dueDate in cols || t.dueDate < today),
      )
      .sort(
        (a, b) =>
          a.priority - b.priority ||
          (a.dueDate! < today || b.dueDate! < today
            ? a.dueDate!.localeCompare(b.dueDate!)
            : 0) ||
          a.order - b.order ||
          a.createdAt.localeCompare(b.createdAt),
      );
    for (const t of active)
      cols[t.dueDate! < today ? OVERDUE : t.dueDate!].push(t.id);
    return cols;
  }, [tasks, dates, today]);

  // Completed tasks pinned at the bottom of their day column.
  const completedItems = useMemo<Items>(() => {
    const cols: Items = Object.fromEntries(dates.map((d) => [d, []]));
    const done = tasks
      .filter(
        (t) =>
          t.status === "completed" && t.dueDate !== null && t.dueDate in cols,
      )
      .sort(
        (a, b) =>
          (a.completedAt ?? "").localeCompare(b.completedAt ?? "") ||
          a.createdAt.localeCompare(b.createdAt),
      );
    for (const t of done) cols[t.dueDate!].push(t.id);
    return cols;
  }, [tasks, dates]);

  // Routine occurrences across the visible range, computed from each cadence.
  // A day that already has a recorded row is left out, so a routine is never
  // shown twice: its completed row is drawn in the column's completed list.
  const routineCardsByDate = useMemo<Record<string, RoutineCardItem[]>>(() => {
    const cols: Record<string, RoutineCardItem[]> = Object.fromEntries(
      dates.map((d) => [d, []]),
    );
    if (dates.length === 0) return cols;
    const recorded = new Set(
      tasks
        .filter((t) => t.routineId !== null && t.dueDate !== null)
        .map((t) => `${t.routineId}|${t.dueDate}`),
    );
    const last = dates[dates.length - 1];
    for (const r of routines) {
      if (!r.active) continue;
      // A completed-based cadence measures from its last completion, so today
      // is its only knowable occurrence and `occurrencesBetween` yields none.
      const days =
        r.repeatBase === "completed"
          ? isDueOn(r, today, r.lastCompletedOn)
            ? [today]
            : []
          : occurrencesBetween(r, dates[0], last);
      for (const d of days) {
        if (recorded.has(`${r.id}|${d}`) || !(d in cols)) continue;
        cols[d].push({ routine: r, variant: d === today ? "today" : "preview" });
      }
    }
    return cols;
  }, [routines, tasks, dates, today]);

  // When idle, render straight from the server cache; during a drag, render the
  // local `items` (seeded on drag start, mutated by onDragOver). This avoids a
  // setState-in-effect sync and keeps the cache the single source of truth.
  const view = activeId ? items : serverItems;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function findContainer(id: string): string | undefined {
    if (id in items) return id;
    return Object.keys(items).find((d) => items[d].includes(id));
  }

  function onDragStart(event: DragStartEvent) {
    setItems(serverItems); // seed local state from the cache for this drag
    setActiveId(event.active.id as string);
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;
    const from = findContainer(activeId);
    const to = findContainer(overId);
    if (!from || !to || from === to) return;
    // Tasks can be dragged OUT of Overdue (rescheduling them) but never in.
    if (to === OVERDUE) return;

    setItems((prev) => {
      const fromItems = prev[from].filter((i) => i !== activeId);
      const toItems = prev[to];
      const overIndex = overId in prev ? toItems.length : toItems.indexOf(overId);
      const insertAt = overIndex < 0 ? toItems.length : overIndex;
      return {
        ...prev,
        [from]: fromItems,
        [to]: [...toItems.slice(0, insertAt), activeId, ...toItems.slice(insertAt)],
      };
    });
  }

  // Fractional order between the nearest SAME-priority neighbors. Columns are
  // ranked priority-first, so `order` is only meaningful within a priority
  // band; a card dropped between different priorities snaps deterministically
  // to the edge of its own band.
  function computeOrder(arr: string[], id: string): number {
    const idx = arr.indexOf(id);
    const myPriority = taskById.get(id)?.priority ?? 4;
    let prevOrder: number | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      const t = taskById.get(arr[i]);
      if (t && t.priority === myPriority) {
        prevOrder = t.order;
        break;
      }
    }
    let nextOrder: number | null = null;
    for (let i = idx + 1; i < arr.length; i++) {
      const t = taskById.get(arr[i]);
      if (t && t.priority === myPriority) {
        nextOrder = t.order;
        break;
      }
    }
    if (prevOrder !== null && nextOrder !== null) return (prevOrder + nextOrder) / 2;
    if (prevOrder !== null) return prevOrder + 1;
    if (nextOrder !== null) return nextOrder - 1;
    return 1;
  }

  function onDragEnd(event: DragEndEvent) {
    lastDragEndAt = Date.now(); // before any early return — every drop counts
    const { active, over } = event;
    const id = active.id as string;
    const container = findContainer(id);
    if (!over || !container) {
      setActiveId(null);
      return;
    }
    const overId = over.id as string;
    let next = items;
    // Same-column reorder.
    if (!(overId in items) && container === findContainer(overId)) {
      const arr = items[container];
      const oldIndex = arr.indexOf(id);
      const newIndex = arr.indexOf(overId);
      if (oldIndex !== newIndex && newIndex >= 0) {
        next = { ...items, [container]: arrayMove(arr, oldIndex, newIndex) };
        setItems(next);
      }
    }
    const order = computeOrder(next[container], id);
    // Inside Overdue the column key is not a date — reordering there keeps
    // the task's own (past) due date.
    const dueDate =
      container === OVERDUE ? taskById.get(id)?.dueDate : container;
    if (dueDate) move.mutate({ id, dueDate, order });
    setActiveId(null);
  }

  const activeTask = activeId ? taskById.get(activeId) : null;

  return (
    <div className="flex h-full flex-col p-6">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Upcoming</h1>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          lastDragEndAt = Date.now();
          setActiveId(null);
        }}
      >
        <div className="flex min-h-0 flex-1 items-start gap-4 overflow-x-auto pb-4">
          {(view[OVERDUE] ?? []).length > 0 && (
            <Column
              date={OVERDUE}
              label="Overdue"
              ids={view[OVERDUE] ?? []}
              completedIds={[]}
              routineCards={[]}
              taskById={taskById}
              projects={projects}
            />
          )}
          {dates.map((date) => (
            <Column
              key={date}
              date={date}
              label={columnLabel(date, today)}
              ids={view[date] ?? []}
              completedIds={completedItems[date] ?? []}
              routineCards={routineCardsByDate[date] ?? []}
              taskById={taskById}
              projects={projects}
            />
          ))}
          <div className="flex w-40 shrink-0 items-start pt-7">
            <Button variant="outline" onClick={() => setHorizon((h) => h + 7)}>
              Load more days
            </Button>
          </div>
        </div>
        {/* dropAnimation off: the default animates the overlay toward the
            task's pre-drop element (still in the source column for a frame),
            which reads as the card flying back before snapping to the target. */}
        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <TaskCard task={activeTask} projects={projects} dragging />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

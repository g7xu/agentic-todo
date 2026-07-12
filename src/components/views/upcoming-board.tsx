"use client";

import { useMemo, useState } from "react";
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
import { Check, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTimezone } from "@/components/timezone-context";
import { addDays, todayStr } from "@/lib/date";
import { QuickAdd } from "@/components/quick-add";
import {
  useCompleteTask,
  useDeleteTask,
  useMoveTask,
  useTasks,
  useUncompleteTask,
} from "@/hooks/use-tasks";
import { useProjects } from "@/hooks/use-projects";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditTaskDialog } from "@/components/edit-task-dialog";
import type { ProjectDTO, TaskDTO } from "@/lib/types";

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

type Items = Record<string, string[]>;

/** Pseudo-column key for active tasks whose due date has passed. */
const OVERDUE = "overdue";

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

  const project = projects.find((p) => p.id === task.projectId);
  const isTemp = task.id.startsWith("temp-");
  const isCompleted = task.status === "completed";

  return (
    <div
      className={cn(
        "bg-card group flex items-start gap-2 rounded-md border p-2 text-sm shadow-sm",
        dragging && "ring-primary/40 ring-2",
        isCompleted && "opacity-70",
      )}
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
        onClick={() =>
          isCompleted ? uncomplete.mutate(task.id) : complete.mutate(task.id)
        }
      >
        {isCompleted && <Check className="size-3" strokeWidth={3} />}
      </button>
      <div className="flex min-w-0 flex-col gap-0.5 overflow-hidden">
        <span
          className={cn(
            "truncate",
            isCompleted && "text-muted-foreground line-through",
          )}
        >
          {task.content}
        </span>
        {task.description && (
          <span
            className={cn(
              "text-muted-foreground truncate text-xs",
              isCompleted && "line-through",
            )}
          >
            {task.description}
          </span>
        )}
        {(showDue && task.dueDate) || (project && !project.isInbox) ? (
          <div className="flex items-center gap-2 text-xs">
            {showDue && task.dueDate && (
              <span className="text-red-500">{shortDate(task.dueDate)}</span>
            )}
            {project && !project.isInbox && (
              <span className="text-muted-foreground"># {project.name}</span>
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
          {editing && (
            <EditTaskDialog
              task={task}
              projects={projects}
              open={editing}
              onOpenChange={setEditing}
            />
          )}
        </div>
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, disabled: task.id.startsWith("temp-") });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("cursor-grab touch-none", isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} projects={projects} showDue={showDue} />
    </div>
  );
}

function Column({
  date,
  label,
  ids,
  completedIds,
  taskById,
  projects,
}: {
  date: string;
  label: string;
  ids: string[];
  completedIds: string[];
  taskById: Map<string, TaskDTO>;
  projects: ProjectDTO[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  const isOverdue = date === OVERDUE;
  return (
    <div className="flex max-h-full w-64 shrink-0 flex-col">
      <div
        className={cn(
          "px-1 pb-2 text-sm font-medium",
          isOverdue && "text-red-500",
        )}
      >
        {label}
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
          {/* Completed tasks stay in their day column, crossed out at the
              bottom; plain cards (no useSortable) so they can't be dragged. */}
          {completedIds.map((id) => {
            const task = taskById.get(id);
            return task ? (
              <TaskCard key={id} task={task} projects={projects} />
            ) : null;
          })}
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
  const tz = useTimezone();
  const today = todayStr(tz);
  const { data: tasks = [] } = useTasks();
  const { data: projects = [] } = useProjects();
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
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex min-h-0 flex-1 items-start gap-4 overflow-x-auto pb-4">
          {(view[OVERDUE] ?? []).length > 0 && (
            <Column
              date={OVERDUE}
              label="Overdue"
              ids={view[OVERDUE] ?? []}
              completedIds={[]}
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

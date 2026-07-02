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
import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTimezone } from "@/components/timezone-context";
import { addDays, todayStr } from "@/lib/date";
import { QuickAdd } from "@/components/quick-add";
import { useMoveTask, useTasks } from "@/hooks/use-tasks";
import { useProjects } from "@/hooks/use-projects";
import { Button } from "@/components/ui/button";
import type { ProjectDTO, TaskDTO } from "@/lib/types";

const PRIORITY_COLOR: Record<number, string> = {
  1: "text-red-500",
  2: "text-orange-500",
  3: "text-blue-500",
  4: "",
};

type Items = Record<string, string[]>;

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
}: {
  task: TaskDTO;
  projects: ProjectDTO[];
  dragging?: boolean;
}) {
  const project = projects.find((p) => p.id === task.projectId);
  return (
    <div
      className={cn(
        "bg-card flex items-start gap-2 rounded-md border p-2 text-sm shadow-sm",
        dragging && "ring-primary/40 ring-2",
      )}
    >
      {task.priority < 4 && (
        <Flag className={cn("mt-0.5 size-3.5 shrink-0", PRIORITY_COLOR[task.priority])} />
      )}
      <div className="flex flex-col gap-0.5 overflow-hidden">
        <span className="truncate">{task.content}</span>
        {project && !project.isInbox && (
          <span className="text-muted-foreground text-xs"># {project.name}</span>
        )}
      </div>
    </div>
  );
}

function SortableTask({
  task,
  projects,
}: {
  task: TaskDTO;
  projects: ProjectDTO[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("cursor-grab touch-none", isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} projects={projects} />
    </div>
  );
}

function Column({
  date,
  label,
  ids,
  taskById,
  projects,
}: {
  date: string;
  label: string;
  ids: string[];
  taskById: Map<string, TaskDTO>;
  projects: ProjectDTO[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  return (
    <div className="flex w-64 shrink-0 flex-col">
      <div className="px-1 pb-2 text-sm font-medium">{label}</div>
      <div
        ref={setNodeRef}
        className={cn(
          "bg-muted/30 flex min-h-24 flex-1 flex-col gap-2 rounded-lg border p-2",
          isOver && "ring-primary/40 ring-2",
        )}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((id) => {
            const task = taskById.get(id);
            return task ? (
              <SortableTask key={id} task={task} projects={projects} />
            ) : null;
          })}
        </SortableContext>
        <div className="mt-auto">
          <QuickAdd defaultDueDate={date} placeholder="Add…" />
        </div>
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

  // Columns derived from the server cache.
  const serverItems = useMemo<Items>(() => {
    const cols: Items = Object.fromEntries(dates.map((d) => [d, []]));
    const active = tasks
      .filter(
        (t) => t.status === "active" && t.dueDate !== null && t.dueDate in cols,
      )
      .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
    for (const t of active) cols[t.dueDate!].push(t.id);
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

  function computeOrder(arr: string[], id: string): number {
    const idx = arr.indexOf(id);
    const prevOrder =
      idx > 0 ? (taskById.get(arr[idx - 1])?.order ?? null) : null;
    const nextOrder =
      idx < arr.length - 1 ? (taskById.get(arr[idx + 1])?.order ?? null) : null;
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
    move.mutate({ id, dueDate: container, order });
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
        <div className="flex flex-1 gap-4 overflow-x-auto pb-4">
          {dates.map((date) => (
            <Column
              key={date}
              date={date}
              label={columnLabel(date, today)}
              ids={view[date] ?? []}
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
        <DragOverlay>
          {activeTask ? (
            <TaskCard task={activeTask} projects={projects} dragging />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

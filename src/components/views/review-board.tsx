"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  closestCorners,
  DndContext,
  pointerWithin,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { addDays } from "@/lib/date";
import { BOARD_COLUMNS, NOTE_KINDS, weekLabel } from "@/lib/reviews";
import {
  useAddNote,
  useDeleteNote,
  useMoveNote,
  useReviewWeek,
  useUpdateNote,
} from "@/hooks/use-reviews";
import { useProjects } from "@/hooks/use-projects";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CloseWeekDialog } from "@/components/reviews/close-week-dialog";
import { DoneThisWeek } from "@/components/reviews/done-this-week";
import type { NoteKind, ReviewNoteDTO } from "@/lib/types";

export const KIND_META: Record<NoteKind, { label: string; caption: string; dot: string }> = {
  unsorted: { label: "Unsorted", caption: "jot it now, sort it later", dot: "bg-muted-foreground" },
  thorn: { label: "Thorn", caption: "what stung", dot: "bg-red-500" },
  rose: { label: "Rose", caption: "what went well", dot: "bg-green-600" },
  seed: { label: "Seed", caption: "worth trying", dot: "bg-amber-500" },
  action: { label: "Action", caption: "do next", dot: "bg-blue-500" },
};

type Items = Record<NoteKind, string[]>;

/**
 * The drop target is whatever is under the pointer; nearest corners only
 * decide when the pointer is over nothing. Corners alone fail for the pile:
 * it is a wide, short strip whose corners sit far out at its ends, so a
 * neighbouring column almost always measured closer.
 */
const pointerFirst: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : closestCorners(args);
};

const emptyItems = (): Items => ({ unsorted: [], thorn: [], rose: [], seed: [], action: [] });

/** Stamped on every drag end so the browser's trailing click after a drop
 * does not open the note for editing (same guard as the Upcoming board). */
let lastDragEndAt = 0;

/** Text editor shared by "add a note" and "edit a note". Enter saves,
 * Shift+Enter breaks the line, Escape cancels. */
function NoteEditor({
  initial = "",
  placeholder,
  onSave,
  onCancel,
  keepOpen = false,
}: {
  initial?: string;
  placeholder?: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  /** Clear and stay open after saving, for writing several notes in a row. */
  keepOpen?: boolean;
}) {
  const [text, setText] = useState(initial);
  // Set once the editor has finished, so the blur that follows a keyboard
  // save or cancel cannot save a second time.
  const finished = useRef(false);

  function commit() {
    const t = text.trim();
    if (t && t !== initial) onSave(t);
    return t;
  }
  function finish(save: boolean) {
    if (finished.current) return;
    finished.current = true;
    if (save) commit();
    onCancel();
  }
  return (
    <Textarea
      autoFocus
      onFocus={(e) => {
        const end = e.currentTarget.value.length;
        e.currentTarget.setSelectionRange(end, end);
      }}
      value={text}
      placeholder={placeholder}
      maxLength={500}
      className="bg-card min-h-12 text-sm"
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          if (keepOpen && commit()) setText("");
          else finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}

function NoteCard({
  note,
  readOnly,
  dragging = false,
  onEdit,
  onDelete,
}: {
  note: ReviewNoteDTO;
  readOnly: boolean;
  dragging?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const isTemp = note.id.startsWith("temp-");
  const pressPos = useRef<{ x: number; y: number } | null>(null);
  const editable = !readOnly && !isTemp && !dragging;
  return (
    <div
      className={cn(
        "bg-card group flex items-start gap-2 rounded-md border p-2 text-sm shadow-sm",
        editable && "cursor-pointer",
        dragging && "ring-primary/40 ring-2",
      )}
      onPointerDown={(e) => {
        pressPos.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e) => {
        if (!editable) return;
        if (Date.now() - lastDragEndAt < 300) return;
        if (!e.currentTarget.contains(e.target as Node)) return;
        const p = pressPos.current;
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) >= 5) return;
        onEdit?.();
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="leading-snug whitespace-pre-wrap wrap-break-word">{note.content}</span>
        {note.carriedTaskId && (
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <ArrowRight className="size-3" /> Carried to next week
          </span>
        )}
      </div>
      {editable && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Note options"
            className="hover:bg-accent shrink-0 rounded p-0.5 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-4" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function SortableNote({
  note,
  week,
  readOnly,
}: {
  note: ReviewNoteDTO;
  week: string;
  readOnly: boolean;
}) {
  const update = useUpdateNote(week);
  const del = useDeleteNote(week);
  const [editing, setEditing] = useState(false);
  const disabled = readOnly || editing || note.id.startsWith("temp-");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: note.id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(!disabled && "cursor-grab", "touch-manipulation", isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
      onPointerDown={(e) => {
        // Portaled menu clicks bubble here through the React tree; only a
        // press physically inside the card may start a drag.
        if (!e.currentTarget.contains(e.target as Node)) return;
        listeners?.onPointerDown?.(e);
      }}
    >
      {editing ? (
        <NoteEditor
          initial={note.content}
          onSave={(content) => update.mutate({ id: note.id, content })}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <NoteCard
          note={note}
          readOnly={readOnly}
          onEdit={() => setEditing(true)}
          onDelete={() => del.mutate(note.id)}
        />
      )}
    </div>
  );
}

function Column({
  kind,
  ids,
  noteById,
  week,
  readOnly,
}: {
  kind: NoteKind;
  ids: string[];
  noteById: Map<string, ReviewNoteDTO>;
  week: string;
  readOnly: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: kind, disabled: readOnly });
  const add = useAddNote(week);
  const [adding, setAdding] = useState(false);
  const meta = KIND_META[kind];
  return (
    <div className="flex min-w-56 flex-1 flex-col">
      <div className="flex flex-col gap-0.5 px-1 pb-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span className={cn("size-2 rounded-full", meta.dot)} aria-hidden />
          {meta.label}
          <span className="text-muted-foreground font-normal tabular-nums">{ids.length || ""}</span>
        </span>
        <span className="text-muted-foreground text-xs">{meta.caption}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "bg-muted/30 flex min-h-24 flex-col gap-2 rounded-lg border p-2",
          isOver && "ring-primary/40 ring-2",
        )}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((id) => {
            const note = noteById.get(id);
            return note ? (
              <SortableNote key={id} note={note} week={week} readOnly={readOnly} />
            ) : null;
          })}
        </SortableContext>
        {!readOnly &&
          (adding ? (
            <NoteEditor
              keepOpen
              placeholder={`Add a ${meta.label.toLowerCase()}…`}
              onSave={(content) => add.mutate({ kind, content })}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center gap-1 rounded-md px-2 py-1 text-left text-sm transition-colors"
              onClick={() => setAdding(true)}
            >
              <Plus className="size-4" /> Add a note
            </button>
          ))}
      </div>
    </div>
  );
}

/**
 * The unsorted pile: thoughts written down as they happen, before deciding
 * which column they belong in. The input stays open so several can be jotted
 * in a row; dragging a note into a column sorts it.
 */
function UnsortedPile({
  ids,
  noteById,
  week,
}: {
  ids: string[];
  noteById: Map<string, ReviewNoteDTO>;
  week: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "unsorted" });
  const add = useAddNote(week);
  const [text, setText] = useState("");
  const meta = KIND_META.unsorted;
  function submit() {
    const content = text.trim();
    if (!content) return;
    add.mutate({ kind: "unsorted", content });
    setText("");
  }
  return (
    <section>
      <div className="flex items-baseline gap-2 px-1 pb-2">
        <span className="text-sm font-medium">
          {meta.label}
          <span className="text-muted-foreground ml-1.5 font-normal tabular-nums">
            {ids.length || ""}
          </span>
        </span>
        <span className="text-muted-foreground text-xs">{meta.caption}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "bg-muted/30 flex flex-col gap-2 rounded-lg border p-2",
          isOver && "ring-primary/40 ring-2",
        )}
      >
        <input
          value={text}
          maxLength={500}
          placeholder="A thought, a worry, an idea… press Enter"
          aria-label="Add an unsorted note"
          className="bg-card placeholder:text-muted-foreground focus-visible:ring-ring/50 w-full rounded-md border px-2 py-1.5 text-sm outline-none focus-visible:ring-3"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {ids.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <SortableContext items={ids} strategy={rectSortingStrategy}>
              {ids.map((id) => {
                const note = noteById.get(id);
                return note ? (
                  <div key={id} className="w-56">
                    <SortableNote note={note} week={week} readOnly={false} />
                  </div>
                ) : null;
              })}
            </SortableContext>
          </div>
        )}
      </div>
    </section>
  );
}

export function ReviewBoard({ week }: { week: string }) {
  const { data, isLoading, isError, refetch } = useReviewWeek(week);
  const { data: projects = [] } = useProjects();
  const move = useMoveNote(week);
  const [items, setItems] = useState<Items>(emptyItems);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const notes = useMemo(() => data?.review?.notes ?? [], [data]);
  const noteById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);

  const serverItems = useMemo<Items>(() => {
    const cols: Items = emptyItems();
    const sorted = [...notes].sort(
      (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt),
    );
    for (const n of sorted) cols[n.kind].push(n.id);
    return cols;
  }, [notes]);

  const view = activeId ? items : serverItems;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  function findContainer(id: string): NoteKind | undefined {
    if ((NOTE_KINDS as readonly string[]).includes(id)) return id as NoteKind;
    return NOTE_KINDS.find((k) => items[k].includes(id));
  }

  function onDragStart(event: DragStartEvent) {
    setItems(serverItems);
    setActiveId(event.active.id as string);
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const id = active.id as string;
    const overId = over.id as string;
    const from = findContainer(id);
    const to = findContainer(overId);
    if (!from || !to || from === to) return;
    setItems((prev) => {
      const toItems = prev[to];
      const overIndex = overId === to ? toItems.length : toItems.indexOf(overId);
      const at = overIndex < 0 ? toItems.length : overIndex;
      return {
        ...prev,
        [from]: prev[from].filter((i) => i !== id),
        [to]: [...toItems.slice(0, at), id, ...toItems.slice(at)],
      };
    });
  }

  /** Midpoint between the dropped note's new neighbours. */
  function computeOrder(arr: string[], id: string): number {
    const idx = arr.indexOf(id);
    const prev = idx > 0 ? noteById.get(arr[idx - 1])?.order : undefined;
    const next = idx < arr.length - 1 ? noteById.get(arr[idx + 1])?.order : undefined;
    if (prev !== undefined && next !== undefined) return (prev + next) / 2;
    if (prev !== undefined) return prev + 1;
    if (next !== undefined) return next - 1;
    return 1;
  }

  function onDragEnd(event: DragEndEvent) {
    lastDragEndAt = Date.now();
    const { active, over } = event;
    const id = active.id as string;
    const container = findContainer(id);
    if (!over || !container) {
      setActiveId(null);
      return;
    }
    const overId = over.id as string;
    let next = items;
    if (overId !== container && container === findContainer(overId)) {
      const arr = items[container];
      const oldIndex = arr.indexOf(id);
      const newIndex = arr.indexOf(overId);
      if (oldIndex !== newIndex && newIndex >= 0) {
        next = { ...items, [container]: arrayMove(arr, oldIndex, newIndex) };
        setItems(next);
      }
    }
    const note = noteById.get(id);
    const unchanged =
      note?.kind === container &&
      serverItems[container].indexOf(id) === next[container].indexOf(id);
    if (note && !unchanged) {
      move.mutate({ id, kind: container, order: computeOrder(next[container], id) });
    }
    setActiveId(null);
  }

  if (isLoading) {
    return <p className="text-muted-foreground p-6 text-sm">Loading…</p>;
  }
  if (isError || !data) {
    return (
      <p className="p-6 text-sm">
        <span className="text-red-600">Couldn’t load this week.</span>{" "}
        <button className="underline" onClick={() => refetch()}>
          Retry
        </button>
      </p>
    );
  }

  const review = data.review;
  const closed = review?.closedAt != null;
  const isFuture = week > data.thisWeek;
  const canClose = !!review && !closed && !isFuture && !review.id.startsWith("temp-");
  const activeNote = activeId ? noteById.get(activeId) : undefined;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon-sm" asChild aria-label="Previous week">
          <Link href={`/reviews/${addDays(week, -7)}`}>
            <ChevronLeft className="size-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{weekLabel(week)}</h1>
        {week < data.thisWeek && (
          <Button variant="ghost" size="icon-sm" asChild aria-label="Next week">
            <Link href={`/reviews/${addDays(week, 7)}`}>
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {closed ? (
            <span className="text-muted-foreground text-sm">Closed</span>
          ) : (
            canClose && (
              <Button size="sm" onClick={() => setClosing(true)}>
                Close week
              </Button>
            )
          )}
        </div>
      </div>
      <p className="text-muted-foreground mb-6 text-sm">
        {week === data.thisWeek ? "This week · " : ""}
        <Link href="/reviews" className="hover:text-foreground underline-offset-2 hover:underline">
          All reviews
        </Link>
      </p>

      <div className="flex flex-col-reverse gap-6 2xl:flex-row 2xl:items-start">
        <DndContext
          sensors={sensors}
          collisionDetection={pointerFirst}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            lastDragEndAt = Date.now();
            setActiveId(null);
          }}
        >
          <div className="flex min-w-0 flex-col gap-4 2xl:flex-1">
            {!closed && <UnsortedPile ids={view.unsorted} noteById={noteById} week={week} />}
            <div className="flex min-w-0 items-start gap-4 overflow-x-auto pb-4">
              {BOARD_COLUMNS.map((kind) => (
                <Column
                  key={kind}
                  kind={kind}
                  ids={view[kind]}
                  noteById={noteById}
                  week={week}
                  readOnly={closed}
                />
              ))}
            </div>
          </div>
          <DragOverlay dropAnimation={null}>
            {activeNote ? <NoteCard note={activeNote} readOnly={false} dragging /> : null}
          </DragOverlay>
        </DndContext>
        <DoneThisWeek tasks={data.completed} projects={projects} />
      </div>

      {closing && review && (
        <CloseWeekDialog
          week={week}
          actions={review.notes.filter((n) => n.kind === "action")}
          unsortedCount={review.notes.filter((n) => n.kind === "unsorted").length}
          open={closing}
          onOpenChange={setClosing}
        />
      )}
    </div>
  );
}

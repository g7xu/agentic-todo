"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  RoutineDTO,
  RoutineRepeatBase,
  RoutineRepeatUnit,
  TaskDTO,
} from "@/lib/types";
import {
  completeRoutineOccurrenceAction,
  createRoutineAction,
  deleteRoutineAction,
  setRoutineDayAction,
  updateRoutineAction,
} from "@/app/actions/routines";
import { TASKS_KEY, useUncompleteTask } from "@/hooks/use-tasks";

export const ROUTINES_KEY = ["routines"] as const;

async function fetchRoutines(): Promise<RoutineDTO[]> {
  const res = await fetch("/api/routines");
  if (!res.ok) throw new Error("Failed to load routines");
  const data = (await res.json()) as { routines: RoutineDTO[] };
  return data.routines;
}

export function useRoutines() {
  return useQuery({ queryKey: ROUTINES_KEY, queryFn: fetchRoutines });
}

export type RoutineDay = {
  routineId: string;
  date: string;
  status: "completed" | "missed";
  /** ISO timestamp; null on a missed day. */
  completedAt: string | null;
  /** Completed on a later day than the one it was due. */
  madeUp: boolean;
};

export type RoutineHistory = { from: string; to: string; days: RoutineDay[] };

/** Recorded routine outcomes for the Activity grid (docs/ROUTINES.md §RV8).
 * Keyed by window length so switching 12 weeks ↔ a year caches both. */
export function useRoutineHistory(days: number) {
  return useQuery({
    queryKey: [...ROUTINES_KEY, "history", days] as const,
    queryFn: async (): Promise<RoutineHistory> => {
      const res = await fetch(`/api/routines/history?days=${days}`);
      if (!res.ok) throw new Error("Failed to load routine history");
      return res.json();
    },
  });
}

export type CreateRoutineInput = {
  content: string;
  description?: string | null;
  priority?: number;
  estimate?: number | null;
  projectId?: string | null;
  repeatEvery?: number;
  repeatUnit?: RoutineRepeatUnit;
  repeatWeekdays?: number[];
  repeatBase?: RoutineRepeatBase;
  endDate?: string | null;
};

export type UpdateRoutineInput = {
  content?: string;
  description?: string | null;
  priority?: number;
  estimate?: number | null;
  projectId?: string;
  repeatEvery?: number;
  repeatUnit?: RoutineRepeatUnit;
  repeatWeekdays?: number[];
  repeatBase?: RoutineRepeatBase;
  endDate?: string | null;
  active?: boolean;
};

/** Routine mutations invalidate ['tasks'] too: a routine's recorded days are
 * task rows, and pausing or rescheduling one can write new ones. */
function useInvalidateBoth() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ROUTINES_KEY });
    qc.invalidateQueries({ queryKey: TASKS_KEY });
  };
}

/** A failed routine write must be visible. Without this a dialog closes on a
 * rejected write and the routine silently never exists. */
function reportError(message: string) {
  return (e: unknown) => {
    console.error(`${message}:`, e);
    toast.error(message);
  };
}

export function useCreateRoutine() {
  const invalidate = useInvalidateBoth();
  return useMutation({
    mutationFn: (input: CreateRoutineInput) => createRoutineAction(input),
    onError: reportError("Couldn’t create the routine"),
    onSettled: invalidate,
  });
}

export function useUpdateRoutine() {
  const invalidate = useInvalidateBoth();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateRoutineInput }) =>
      updateRoutineAction(id, input),
    onError: reportError("Couldn’t save the routine"),
    onSettled: invalidate,
  });
}

/**
 * The tick on a routine card. Optimistic: a stand-in completed row goes into
 * the ['tasks'] cache at once, which is what hides the card, and the row the
 * server recorded replaces it when the write lands.
 */
export function useCompleteRoutineOccurrence() {
  const qc = useQueryClient();
  const invalidate = useInvalidateBoth();
  const uncomplete = useUncompleteTask();
  return useMutation<
    TaskDTO,
    Error,
    { routine: RoutineDTO; date: string },
    { prev?: TaskDTO[]; tempId: string }
  >({
    mutationFn: ({ routine, date }) =>
      completeRoutineOccurrenceAction(routine.id, date),
    onMutate: async ({ routine, date }) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY });
      const now = new Date().toISOString();
      const tempId = `temp-${crypto.randomUUID()}`;
      const standIn: TaskDTO = {
        id: tempId,
        content: routine.content,
        description: routine.description,
        priority: routine.priority,
        dueDate: date,
        deadline: null,
        estimate: routine.estimate,
        timeUsed: null,
        status: "completed",
        order: Number.MAX_SAFE_INTEGER,
        projectId: routine.projectId,
        routineId: routine.id,
        completedAt: now,
        createdAt: now,
      };
      const prev = qc.getQueryData<TaskDTO[]>(TASKS_KEY);
      qc.setQueryData<TaskDTO[]>(TASKS_KEY, (old = []) => [...old, standIn]);
      return { prev, tempId };
    },
    onSuccess: (task, _vars, ctx) => {
      qc.setQueryData<TaskDTO[]>(TASKS_KEY, (old = []) => [
        ...old.filter((t) => t.id !== ctx.tempId && t.id !== task.id),
        task,
      ]);
      toast("Routine done", {
        action: { label: "Undo", onClick: () => uncomplete.mutate(task.id) },
      });
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(TASKS_KEY, ctx.prev);
      reportError("Couldn’t complete that routine")(e);
    },
    onSettled: invalidate,
  });
}

/** Correct one day of one routine from the Activity grid (§RV9). Invalidates
 * ['tasks'] too: clearing or un-completing a day changes real task rows. */
export function useSetRoutineDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      routineId,
      date,
      status,
      completedAt,
    }: {
      routineId: string;
      date: string;
      status: "completed" | "missed" | "clear";
      /** Restores an earlier completion time instead of stamping the present. */
      completedAt?: string;
    }) => setRoutineDayAction(routineId, date, status, completedAt),
    onError: reportError("Couldn’t update that day"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ROUTINES_KEY });
      qc.invalidateQueries({ queryKey: TASKS_KEY });
    },
  });
}

export function useDeleteRoutine() {
  const invalidate = useInvalidateBoth();
  return useMutation({
    mutationFn: (id: string) => deleteRoutineAction(id),
    onError: reportError("Couldn’t delete the routine"),
    onSettled: invalidate,
  });
}

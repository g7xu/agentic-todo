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
  materializeRoutineOccurrenceAction,
  setRoutineDayAction,
  updateRoutineAction,
} from "@/app/actions/routines";
import { TASKS_KEY } from "@/hooks/use-tasks";

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
};

export type RoutineHistory = { from: string; to: string; days: RoutineDay[] };

/** Recorded routine instances for the Activity grid (docs/ROUTINES.md §RV8).
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

/** Routine mutations invalidate ['tasks'] too: the refetch runs
 * materialization, so a new/resumed routine's instance appears immediately
 * and a deleted routine's active instance disappears. */
function useInvalidateBoth() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ROUTINES_KEY });
    qc.invalidateQueries({ queryKey: TASKS_KEY });
  };
}

/** Routine writes are not optimistic, so a failure leaves no wrong state to roll
 * back — but it must still be visible. Without this the dialog closes on a
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

/** Complete a projected future occurrence (an Upcoming ghost card). Not
 * optimistic: there is no row to patch until the server creates one, and the
 * ['tasks'] refetch is what turns the ghost into a real completed card. */
export function useCompleteRoutineOccurrence() {
  const invalidate = useInvalidateBoth();
  return useMutation({
    mutationFn: ({ routineId, date }: { routineId: string; date: string }) =>
      completeRoutineOccurrenceAction(routineId, date),
    onError: reportError("Couldn’t complete that occurrence"),
    onSettled: invalidate,
  });
}

/** Turn an Upcoming ghost into a real, still-to-do task (§RV10). The created
 * task is written straight into the ['tasks'] cache so the card appears in
 * place of the ghost without waiting for the refetch, and returned to the
 * caller so it can open the editor on it. */
export function useMaterializeRoutineOccurrence() {
  const qc = useQueryClient();
  const invalidate = useInvalidateBoth();
  return useMutation({
    mutationFn: ({ routineId, date }: { routineId: string; date: string }) =>
      materializeRoutineOccurrenceAction(routineId, date),
    onSuccess: (task) => {
      qc.setQueryData<TaskDTO[]>(TASKS_KEY, (old = []) =>
        // A lost race returns the row that already existed — don't double it.
        old.some((t) => t.id === task.id) ? old : [...old, task],
      );
    },
    onError: reportError("Couldn’t add that occurrence"),
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
    }: {
      routineId: string;
      date: string;
      status: "completed" | "missed" | "clear";
    }) => setRoutineDayAction(routineId, date, status),
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

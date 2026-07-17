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
} from "@/lib/types";
import {
  createRoutineAction,
  deleteRoutineAction,
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

export type CreateRoutineInput = {
  content: string;
  description?: string | null;
  priority?: number;
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

export function useDeleteRoutine() {
  const invalidate = useInvalidateBoth();
  return useMutation({
    mutationFn: (id: string) => deleteRoutineAction(id),
    onError: reportError("Couldn’t delete the routine"),
    onSettled: invalidate,
  });
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CapacityDTO } from "@/lib/types";
import {
  setDayCapacityAction,
  setDefaultCapacityAction,
} from "@/app/actions/capacity";

export const CAPACITY_KEY = ["capacity"] as const;

async function fetchCapacity(): Promise<CapacityDTO> {
  const res = await fetch("/api/capacity");
  if (!res.ok) throw new Error("Failed to load available time");
  return res.json();
}

export function useCapacity() {
  return useQuery({ queryKey: CAPACITY_KEY, queryFn: fetchCapacity });
}

/** Optimistic write of one capacity value; rolls back and says so on failure. */
function useCapacityMutation<V>(
  write: (vars: V) => Promise<void>,
  apply: (old: CapacityDTO, vars: V) => CapacityDTO,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, V, { prev?: CapacityDTO }>({
    mutationFn: write,
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: CAPACITY_KEY });
      const prev = qc.getQueryData<CapacityDTO>(CAPACITY_KEY);
      if (prev) qc.setQueryData(CAPACITY_KEY, apply(prev, vars));
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(CAPACITY_KEY, ctx.prev);
      console.error("Couldn’t save available time:", e);
      toast.error("Couldn’t save available time");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CAPACITY_KEY }),
  });
}

export function useSetDefaultCapacity() {
  return useCapacityMutation<number | null>(
    (minutes) => setDefaultCapacityAction(minutes),
    (old, minutes) => ({ ...old, defaultMinutes: minutes }),
  );
}

export function useSetDayCapacity() {
  return useCapacityMutation<{ date: string; minutes: number | null }>(
    ({ date, minutes }) => setDayCapacityAction(date, minutes),
    (old, { date, minutes }) => {
      const days = { ...old.days };
      if (minutes === null) delete days[date];
      else days[date] = minutes;
      return { ...old, days };
    },
  );
}

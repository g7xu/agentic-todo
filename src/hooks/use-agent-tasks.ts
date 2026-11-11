"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  answerAgentAction,
  handToAgentAction,
  listTaskActivityAction,
  takeBackFromAgentAction,
} from "@/app/actions/agent-tasks";
import { TASKS_KEY } from "@/hooks/use-tasks";
import type { TaskDTO } from "@/lib/types";

/**
 * The agent log of one task. Keyed under TASKS_KEY so that every write that
 * refreshes the task list refreshes the log too.
 */
export function useTaskActivity(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...TASKS_KEY, "activity", taskId] as const,
    queryFn: () => listTaskActivityAction(taskId),
    enabled,
    refetchOnWindowFocus: "always",
  });
}

/** One hand-off write: the returned task replaces the cached one. */
function useAgentWrite<V>(fn: (v: V) => Promise<TaskDTO>, failure: string) {
  const qc = useQueryClient();
  return useMutation<TaskDTO, Error, V>({
    mutationFn: fn,
    onSuccess: (task) => {
      qc.setQueryData<TaskDTO[]>(TASKS_KEY, (old = []) =>
        old.map((t) => (t.id === task.id ? task : t)),
      );
    },
    onError: () => toast.error(failure),
    onSettled: () => qc.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

export function useHandToAgent() {
  return useAgentWrite((id: string) => handToAgentAction(id), "Couldn't hand the task to Claude");
}

export function useTakeBackFromAgent() {
  return useAgentWrite(
    (id: string) => takeBackFromAgentAction(id),
    "Couldn't take the task back",
  );
}

export function useAnswerAgent() {
  return useAgentWrite(
    ({ id, text }: { id: string; text: string }) => answerAgentAction(id, text),
    "Couldn't send your answer",
  );
}

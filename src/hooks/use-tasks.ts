"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { TaskDTO } from "@/lib/types";
import {
  completeTaskAction,
  createTaskAction,
  deleteTaskAction,
  moveTaskAction,
  uncompleteTaskAction,
  updateTaskAction,
} from "@/app/actions/tasks";

export const TASKS_KEY = ["tasks"] as const;

async function fetchTasks(): Promise<TaskDTO[]> {
  const res = await fetch("/api/tasks");
  if (!res.ok) throw new Error("Failed to load tasks");
  const data = (await res.json()) as { tasks: TaskDTO[] };
  return data.tasks;
}

export function useTasks() {
  return useQuery({ queryKey: TASKS_KEY, queryFn: fetchTasks });
}

type Ctx = { prev?: TaskDTO[] };

function patch(
  qc: ReturnType<typeof useQueryClient>,
  fn: (tasks: TaskDTO[]) => TaskDTO[],
) {
  const prev = qc.getQueryData<TaskDTO[]>(TASKS_KEY);
  qc.setQueryData<TaskDTO[]>(TASKS_KEY, (old = []) => fn(old));
  return prev;
}

export type CreateInput = {
  content: string;
  description?: string | null;
  priority?: number;
  dueDate?: string | null;
  projectId?: string | null;
};

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation<TaskDTO, Error, CreateInput, Ctx>({
    mutationFn: (input) => createTaskAction(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY });
      const optimistic: TaskDTO = {
        id: `temp-${crypto.randomUUID()}`,
        content: input.content,
        description: input.description ?? null,
        priority: input.priority ?? 4,
        dueDate: input.dueDate ?? null,
        status: "active",
        order: Number.MAX_SAFE_INTEGER,
        projectId: input.projectId ?? "",
        completedAt: null,
        createdAt: new Date().toISOString(),
      };
      const prev = patch(qc, (tasks) => [...tasks, optimistic]);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(TASKS_KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation<
    TaskDTO,
    Error,
    { id: string; input: Partial<Omit<TaskDTO, "id" | "status">> },
    Ctx
  >({
    mutationFn: ({ id, input }) =>
      updateTaskAction(id, {
        content: input.content,
        description: input.description,
        priority: input.priority,
        dueDate: input.dueDate,
        projectId: input.projectId,
      }),
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY });
      const prev = patch(qc, (tasks) =>
        tasks.map((t) => (t.id === id ? { ...t, ...input } : t)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(TASKS_KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

export function useUncompleteTask() {
  const qc = useQueryClient();
  return useMutation<TaskDTO, Error, string, Ctx>({
    mutationFn: (id) => uncompleteTaskAction(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY });
      const prev = patch(qc, (tasks) =>
        tasks.map((t) =>
          t.id === id ? { ...t, status: "active", completedAt: null } : t,
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(TASKS_KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  const uncomplete = useUncompleteTask();
  return useMutation<TaskDTO, Error, string, Ctx>({
    mutationFn: (id) => completeTaskAction(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY });
      const prev = patch(qc, (tasks) =>
        tasks.map((t) =>
          t.id === id
            ? { ...t, status: "completed", completedAt: new Date().toISOString() }
            : t,
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(TASKS_KEY, ctx.prev);
    },
    onSuccess: (_data, id) => {
      toast("Task completed", {
        action: { label: "Undo", onClick: () => uncomplete.mutate(id) },
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

export function useMoveTask() {
  const qc = useQueryClient();
  return useMutation<
    TaskDTO,
    Error,
    { id: string; dueDate: string; order: number },
    Ctx
  >({
    mutationFn: ({ id, dueDate, order }) =>
      moveTaskAction(id, { dueDate, order }),
    onMutate: async ({ id, dueDate, order }) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY });
      const prev = patch(qc, (tasks) =>
        tasks.map((t) => (t.id === id ? { ...t, dueDate, order } : t)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(TASKS_KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation<void, Error, string, Ctx>({
    mutationFn: (id) => deleteTaskAction(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: TASKS_KEY });
      const prev = patch(qc, (tasks) => tasks.filter((t) => t.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(TASKS_KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

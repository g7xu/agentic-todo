"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ProjectDTO } from "@/lib/types";
import {
  createProjectAction,
  deleteProjectAction,
  renameProjectAction,
} from "@/app/actions/projects";
import { TASKS_KEY } from "@/hooks/use-tasks";

export const PROJECTS_KEY = ["projects"] as const;

async function fetchProjects(): Promise<ProjectDTO[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Failed to load projects");
  const data = (await res.json()) as { projects: ProjectDTO[] };
  return data.projects;
}

export function useProjects() {
  return useQuery({ queryKey: PROJECTS_KEY, queryFn: fetchProjects });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createProjectAction(name),
    onSettled: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  });
}

export function useRenameProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameProjectAction(id, name),
    onSettled: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProjectAction(id),
    onSettled: () => {
      // Tasks were reassigned to Inbox, so refresh both caches.
      qc.invalidateQueries({ queryKey: PROJECTS_KEY });
      qc.invalidateQueries({ queryKey: TASKS_KEY });
    },
  });
}

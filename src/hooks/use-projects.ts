"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { ProjectDTO } from "@/lib/types";
import {
  createProjectAction,
  deleteProjectAction,
  renameProjectAction,
} from "@/app/actions/projects";
import { TASKS_KEY } from "@/hooks/use-tasks";
import { ROUTINES_KEY } from "@/hooks/use-routines";

export const PROJECTS_KEY = ["projects"] as const;

async function fetchProjects(): Promise<ProjectDTO[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Failed to load projects");
  const data = (await res.json()) as { projects: ProjectDTO[] };
  return data.projects;
}

/** Refetched on every focus so a project created through MCP shows up when
 * the user comes back to the tab, even inside the global staleTime. */
export function useProjects() {
  return useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: fetchProjects,
    refetchOnWindowFocus: "always",
  });
}

/** Project writes are not optimistic, so a rejected write leaves the UI
 * exactly as it was — which is indistinguishable from the click doing nothing
 * unless the failure is surfaced. */
function reportError(message: string) {
  return (e: unknown) => {
    console.error(`${message}:`, e);
    toast.error(message);
  };
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createProjectAction(name),
    onError: reportError("Couldn’t create the project"),
    onSettled: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  });
}

export function useRenameProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameProjectAction(id, name),
    onError: reportError("Couldn’t rename the project"),
    onSettled: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProjectAction(id),
    onError: reportError("Couldn’t delete the project"),
    onSettled: () => {
      // Tasks and routines were reassigned to Inbox, so refresh every cache
      // that shows a project name.
      qc.invalidateQueries({ queryKey: PROJECTS_KEY });
      qc.invalidateQueries({ queryKey: TASKS_KEY });
      qc.invalidateQueries({ queryKey: ROUTINES_KEY });
    },
  });
}

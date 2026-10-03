"use server";

import { requireUser } from "@/lib/auth/session";
import {
  createProject,
  deleteProjectReassign,
  renameProject,
} from "@/lib/data/projects";
import type { ProjectDTO } from "@/lib/types";
import {
  idSchema,
  projectNameSchema as nameSchema,
} from "@/lib/validation/projects";

export async function createProjectAction(name: string): Promise<ProjectDTO> {
  const user = await requireUser();
  return createProject(user.id, nameSchema.parse(name));
}

export async function renameProjectAction(
  id: string,
  name: string,
): Promise<void> {
  const user = await requireUser();
  await renameProject(user.id, idSchema.parse(id), nameSchema.parse(name));
}

export async function deleteProjectAction(id: string): Promise<void> {
  const user = await requireUser();
  await deleteProjectReassign(user.id, idSchema.parse(id));
}

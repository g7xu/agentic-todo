"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import {
  createProject,
  deleteProjectReassign,
  renameProject,
} from "@/lib/data/projects";
import type { ProjectDTO } from "@/lib/types";

const nameSchema = z.string().trim().min(1).max(120);
const idSchema = z.string().uuid();

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

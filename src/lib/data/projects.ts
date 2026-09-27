import { prisma } from "@/lib/db";
import type { ProjectDTO } from "@/lib/types";

type ProjectRow = {
  id: string;
  name: string;
  color: string | null;
  isInbox: boolean;
  order: number;
};

function toDTO(p: ProjectRow): ProjectDTO {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    isInbox: p.isInbox,
    order: p.order,
  };
}

/** All of the user's projects, Inbox first, then by order/created. */
export async function listProjects(userId: string): Promise<ProjectDTO[]> {
  const rows = await prisma.project.findMany({
    where: { userId },
    orderBy: [{ isInbox: "desc" }, { order: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, color: true, isInbox: true, order: true },
  });
  return rows.map(toDTO);
}

export async function getInboxId(userId: string): Promise<string> {
  const inbox = await prisma.project.findFirst({
    where: { userId, isInbox: true },
    select: { id: true },
  });
  if (!inbox) throw new Error("Inbox project missing for user");
  return inbox.id;
}

/** True if `projectId` belongs to `userId` (referential-integrity guard, TDD §6.2/§7). */
export async function userOwnsProject(
  userId: string,
  projectId: string,
): Promise<boolean> {
  const p = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  return p !== null;
}

export async function createProject(
  userId: string,
  name: string,
): Promise<ProjectDTO> {
  const max = await prisma.project.aggregate({
    where: { userId },
    _max: { order: true },
  });
  const order = (max._max.order ?? 0) + 1;
  const p = await prisma.project.create({
    data: { userId, name, order },
    select: { id: true, name: true, color: true, isInbox: true, order: true },
  });
  return toDTO(p);
}

export async function renameProject(
  userId: string,
  id: string,
  name: string,
): Promise<void> {
  // Scoped to the user; Inbox may be renamed but not deleted/un-inboxed.
  await prisma.project.updateMany({ where: { id, userId }, data: { name } });
}

/**
 * Delete a non-Inbox project: reassign its tasks AND routines to the user's
 * Inbox, then delete — all-or-nothing in one transaction (TDD §3). Routines
 * must move too: their project FK is ON DELETE RESTRICT, so leaving one
 * behind makes the delete fail outright. Rejects deleting Inbox.
 */
export async function deleteProjectReassign(
  userId: string,
  id: string,
): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id, userId },
    select: { id: true, isInbox: true },
  });
  if (!project) throw new Error("Project not found");
  if (project.isInbox) throw new Error("The Inbox project cannot be deleted");

  const inboxId = await getInboxId(userId);
  await prisma.$transaction([
    prisma.task.updateMany({
      where: { projectId: id, userId },
      data: { projectId: inboxId },
    }),
    prisma.routine.updateMany({
      where: { projectId: id, userId },
      data: { projectId: inboxId },
    }),
    prisma.project.delete({ where: { id } }),
  ]);
}

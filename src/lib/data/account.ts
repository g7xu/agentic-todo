import { prisma } from "@/lib/db";
import { listProjects } from "@/lib/data/projects";
import { listRoutines } from "@/lib/data/routines";
import { TASK_SELECT, taskToDTO } from "@/lib/data/tasks";
import type { ProjectDTO, RoutineDTO, TaskDTO } from "@/lib/types";

/**
 * Everything the user put into the app, in the same shapes the API serves.
 * Bump `version` when a field is renamed or removed, so an importer can tell
 * the shapes apart.
 */
export type AccountExport = {
  format: "agentictodo-export";
  version: 1;
  exportedAt: string;
  profile: { email: string; timezone: string; createdAt: string } | null;
  projects: ProjectDTO[];
  routines: RoutineDTO[];
  /** Every task whatever its status, unlike `listTasks`, which windows completed ones. */
  tasks: TaskDTO[];
};

export async function exportAccount(userId: string): Promise<AccountExport> {
  const [profile, projects, routines, tasks] = await Promise.all([
    prisma.profile.findUnique({
      where: { id: userId },
      select: { email: true, timezone: true, createdAt: true },
    }),
    listProjects(userId),
    listRoutines(userId),
    prisma.task.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: TASK_SELECT,
    }),
  ]);

  return {
    format: "agentictodo-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: profile && {
      email: profile.email,
      timezone: profile.timezone,
      createdAt: profile.createdAt.toISOString(),
    },
    projects,
    routines,
    tasks: tasks.map(taskToDTO),
  };
}

/**
 * Removes every app-owned row for the user in one transaction: tasks,
 * routines, projects, the profile, and the OAuth grants (their tokens
 * cascade) and codes that let MCP clients act for them. Shared
 * `OAuthClient` rows stay, since other users' grants point at them.
 *
 * The Neon Auth user is not touched here; it lives in a schema this app
 * does not own and is deleted through the auth API.
 */
export async function deleteAccountData(userId: string): Promise<void> {
  const where = { userId };
  // Order follows the foreign keys: tasks reference routines and projects,
  // routines reference projects, and all three reference the profile.
  await prisma.$transaction([
    prisma.oAuthGrant.deleteMany({ where }),
    prisma.oAuthCode.deleteMany({ where }),
    prisma.task.deleteMany({ where }),
    prisma.routine.deleteMany({ where }),
    prisma.project.deleteMany({ where }),
    prisma.profile.deleteMany({ where: { id: userId } }),
  ]);
}

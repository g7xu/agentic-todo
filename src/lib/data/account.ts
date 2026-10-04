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
 * Deletes the account in one transaction: every app-owned row (tasks,
 * routines, projects, profile, and the OAuth grants, tokens and codes that
 * let MCP clients act for the user) and the user's row in Neon Auth's
 * `neon_auth.user` table. Shared `OAuthClient` rows stay, since other
 * users' grants point at them.
 *
 * The auth row is deleted with SQL because managed Neon Auth disables its
 * own delete-user endpoint. `tests/e2e/account-delete.ts` checks that the
 * user's sessions and linked sign-in methods go with it; if Neon's schema
 * stops allowing this delete, the transaction fails and nothing is deleted.
 */
export async function deleteAccount(userId: string): Promise<void> {
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
    prisma.$executeRaw`DELETE FROM neon_auth."user" WHERE id = ${userId}::uuid`,
  ]);
}

/**
 * Test fixtures for black-box abuse testing of the MCP/OAuth surface
 * (docs/MCP.md §4). Dev database only. Provisions a second user, seeds one
 * task per user, and mints tokens straight into the store so the tester
 * never needs a browser session:
 *
 *   npx tsx --tsconfig tsconfig.json --env-file=.env.local tests/e2e/mcp-fixtures.ts <ownerEmail> > fixtures.json
 *
 * Re-runnable: previous fixture rows (identified by the fixture client id and
 * the fixture users' emails) are removed first.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { getInboxId } from "@/lib/data/projects";
import { createTask } from "@/lib/data/tasks";
import { ACCESS_TTL_S, REFRESH_TTL_S, SCOPE_STRING } from "@/lib/oauth/config";
import { generateToken, hashToken } from "@/lib/oauth/tokens";
import { ensureUserProvisioned } from "@/lib/provisioning";

const FIXTURE_CLIENT = "dcr_fixture_abuse_client";

/**
 * Neon endpoint ids this script may write to. It deletes users and mints a
 * live token for the owner, so pointing it at production by accident must
 * fail before the first query. Add a host here or set E2E_ALLOW_DB_HOST.
 */
const ALLOWED_DB_ENDPOINTS = ["ep-spring-fire-at5o8npl"];

function assertDevDatabase(): void {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const host = new URL(url).hostname;
  const allowed =
    ALLOWED_DB_ENDPOINTS.some((ep) => host.startsWith(ep)) ||
    process.env.E2E_ALLOW_DB_HOST === host;
  if (!allowed) {
    throw new Error(
      `refusing to write fixtures to ${host}: not a known development endpoint`,
    );
  }
}
const USER_B_EMAIL = "fixture-user-b@example.invalid";
const USER_C_EMAIL = "fixture-user-c@example.invalid";

async function mint(
  userId: string,
  opts: { accessExpired?: boolean; refreshExpired?: boolean; revoked?: boolean } = {},
) {
  const grant = await prisma.oAuthGrant.create({
    data: { userId, clientId: FIXTURE_CLIENT, scope: SCOPE_STRING },
  });
  const access = generateToken("at");
  const refresh = generateToken("rt");
  const now = Date.now();
  await prisma.oAuthToken.createMany({
    data: [
      {
        grantId: grant.id,
        kind: "access",
        tokenHash: hashToken(access),
        expiresAt: new Date(opts.accessExpired ? now - 60_000 : now + ACCESS_TTL_S * 1000),
      },
      {
        grantId: grant.id,
        kind: "refresh",
        tokenHash: hashToken(refresh),
        expiresAt: new Date(opts.refreshExpired ? now - 60_000 : now + REFRESH_TTL_S * 1000),
      },
    ],
  });
  if (opts.revoked) await prisma.oAuthGrant.delete({ where: { id: grant.id } });
  return { access, refresh, grantId: grant.id };
}

async function main() {
  assertDevDatabase();
  const ownerEmail = process.argv[2];
  if (!ownerEmail) throw new Error("usage: mcp-fixtures.ts <ownerEmail>");
  const owner = await prisma.profile.findFirst({ where: { email: ownerEmail } });
  if (!owner) throw new Error(`no profile for ${ownerEmail}`);

  // Reset previous fixture state.
  await prisma.oAuthClient.deleteMany({ where: { id: FIXTURE_CLIENT } });
  const stale = await prisma.profile.findMany({
    where: { email: { in: [USER_B_EMAIL, USER_C_EMAIL] } },
    select: { id: true },
  });
  for (const p of stale) {
    await prisma.task.deleteMany({ where: { userId: p.id } });
    await prisma.routine.deleteMany({ where: { userId: p.id } });
    await prisma.project.deleteMany({ where: { userId: p.id } });
    await prisma.profile.delete({ where: { id: p.id } });
  }
  await prisma.task.deleteMany({
    where: { userId: owner.id, content: { startsWith: "[fixture]" } },
  });

  await prisma.oAuthClient.create({
    data: {
      id: FIXTURE_CLIENT,
      kind: "dcr",
      name: "abuse fixtures",
      redirectUris: ["http://127.0.0.1/callback"],
    },
  });

  const userB = randomUUID();
  const userC = randomUUID();
  await ensureUserProvisioned(userB, USER_B_EMAIL);
  await ensureUserProvisioned(userC, USER_C_EMAIL);

  const ownerTask = await createTask(owner.id, {
    content: "[fixture] owner's private task",
    description: "belongs to the owner; nobody else may read or change it",
    dueDate: "2026-12-01",
  });
  const ownerProjectId = await getInboxId(owner.id);
  const bTask = await createTask(userB, { content: "[fixture] user B's task" });
  const bProjectId = await getInboxId(userB);

  const out = {
    base: "http://localhost:3001",
    owner: {
      userId: owner.id,
      taskId: ownerTask.id,
      inboxProjectId: ownerProjectId,
      tokens: {
        valid: await mint(owner.id),
        accessExpired: await mint(owner.id, { accessExpired: true }),
        refreshExpired: await mint(owner.id, { refreshExpired: true }),
        revoked: await mint(owner.id, { revoked: true }),
      },
    },
    userB: {
      userId: userB,
      taskId: bTask.id,
      inboxProjectId: bProjectId,
      tokens: { valid: await mint(userB) },
    },
    userC: {
      userId: userC,
      tokens: { valid: await mint(userC) },
    },
    clientId: FIXTURE_CLIENT,
  };
  console.log(JSON.stringify(out, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

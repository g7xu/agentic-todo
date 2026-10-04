/**
 * Exercises account export and deletion against the dev database. Seeds a
 * throwaway user across every table deletion must reach, including a Neon
 * Auth user with a session and a linked sign-in method, then checks that:
 *
 *   - the export holds every row, with dates as YYYY-MM-DD;
 *   - `deleteAccount` leaves no row for the user, in the app's tables or
 *     Neon Auth's;
 *   - a session that outlives the account cannot re-provision it;
 *   - a repeat delete is a no-op;
 *   - every other user's rows are untouched.
 *
 * Exits non-zero on the first failed check. Leaves nothing behind.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { deleteAccount, exportAccount } from "@/lib/data/account";
import { provisionSessionUser } from "@/lib/provisioning";
import { assertDevDatabase } from "./dev-database";

type Counts = Record<string, number>;

async function countRows(uid: string, mine: boolean): Promise<Counts> {
  const op = mine ? "=" : "<>";
  const [row] = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(
    `SELECT
       (SELECT count(*) FROM profiles WHERE id ${op} $1::uuid) AS profiles,
       (SELECT count(*) FROM projects WHERE user_id ${op} $1::uuid) AS projects,
       (SELECT count(*) FROM tasks WHERE user_id ${op} $1::uuid) AS tasks,
       (SELECT count(*) FROM routines WHERE user_id ${op} $1::uuid) AS routines,
       (SELECT count(*) FROM oauth_grants WHERE user_id ${op} $1::uuid) AS grants,
       (SELECT count(*) FROM oauth_codes WHERE user_id ${op} $1::uuid) AS codes,
       (SELECT count(*) FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id
          WHERE g.user_id ${op} $1::uuid) AS tokens,
       (SELECT count(*) FROM neon_auth."user" WHERE id ${op} $1::uuid) AS auth_users,
       (SELECT count(*) FROM neon_auth.session WHERE "userId" ${op} $1::uuid) AS auth_sessions,
       (SELECT count(*) FROM neon_auth.account WHERE "userId" ${op} $1::uuid) AS auth_accounts`,
    uid,
  );
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, Number(v)]),
  );
}

async function seed(uid: string, clientId: string): Promise<void> {
  const email = `account-delete-${uid}@example.invalid`;
  await prisma.$executeRaw`
    INSERT INTO neon_auth."user" (id, name, email, "emailVerified")
    VALUES (${uid}::uuid, 'Account delete test', ${email}, true)`;
  await prisma.$executeRaw`
    INSERT INTO neon_auth.session ("userId", token, "expiresAt", "updatedAt")
    VALUES (${uid}::uuid, ${`tok-${uid}`}, now() + interval '1 day', now())`;
  await prisma.$executeRaw`
    INSERT INTO neon_auth.account ("userId", "accountId", "providerId", "updatedAt")
    VALUES (${uid}::uuid, ${uid}, 'google', now())`;

  await prisma.profile.create({ data: { id: uid, email } });
  const inbox = await prisma.project.create({
    data: { userId: uid, name: "Inbox", isInbox: true },
  });
  const work = await prisma.project.create({
    data: { userId: uid, name: "Work" },
  });
  const routine = await prisma.routine.create({
    data: { userId: uid, projectId: work.id, content: "Daily review" },
  });
  await prisma.task.createMany({
    data: [
      { userId: uid, projectId: inbox.id, content: "plain", dueDate: new Date("2026-10-05") },
      { userId: uid, projectId: work.id, content: "done", status: "completed", completedAt: new Date() },
      {
        userId: uid,
        projectId: work.id,
        content: "Daily review",
        routineId: routine.id,
        status: "completed",
        dueDate: new Date("2026-10-01"),
        completedAt: new Date(),
      },
    ],
  });

  await prisma.oAuthClient.create({
    data: { id: clientId, kind: "dcr", redirectUris: ["http://localhost/callback"] },
  });
  const grant = await prisma.oAuthGrant.create({
    data: { userId: uid, clientId, scope: "tasks:read tasks:write" },
  });
  const later = (s: number) => new Date(Date.now() + s * 1000);
  await prisma.oAuthToken.createMany({
    data: [
      { grantId: grant.id, kind: "access", tokenHash: `a-${uid}`, expiresAt: later(3600) },
      { grantId: grant.id, kind: "refresh", tokenHash: `r-${uid}`, expiresAt: later(86400) },
    ],
  });
  await prisma.oAuthCode.create({
    data: {
      codeHash: `c-${uid}`,
      clientId,
      userId: uid,
      redirectUri: "http://localhost/callback",
      scope: "tasks:read",
      codeChallenge: "unused",
      expiresAt: later(60),
    },
  });
}

async function main() {
  assertDevDatabase();
  const uid = randomUUID();
  const clientId = `dcr_account_delete_${uid}`;
  const othersBefore = await countRows(uid, false);

  try {
    await seed(uid, clientId);

    const seeded = await countRows(uid, true);
    assert.ok(
      Object.values(seeded).every((n) => n > 0),
      `seed reached every table: ${JSON.stringify(seeded)}`,
    );

    const exported = await exportAccount(uid);
    assert.equal(exported.profile?.email, `account-delete-${uid}@example.invalid`);
    assert.equal(exported.projects.length, 2);
    assert.equal(exported.routines.length, 1);
    assert.equal(exported.tasks.length, 3, "export includes completed and routine tasks");
    assert.ok(exported.tasks.some((t) => t.dueDate === "2026-10-05"), "dates export as YYYY-MM-DD");
    console.log("PASS export holds every row");

    await deleteAccount(uid);
    const left = await countRows(uid, true);
    assert.ok(
      Object.values(left).every((n) => n === 0),
      `rows left after delete: ${JSON.stringify(left)}`,
    );
    console.log("PASS delete leaves no row in app or auth tables");

    assert.equal(
      await provisionSessionUser(uid, `account-delete-${uid}@example.invalid`),
      false,
      "a stale session cannot re-provision a deleted user",
    );
    assert.equal(await prisma.profile.count({ where: { id: uid } }), 0);
    console.log("PASS a stale session cannot re-provision the deleted user");

    assert.equal(
      await prisma.oAuthClient.count({ where: { id: clientId } }),
      1,
      "shared client row survives",
    );
    await deleteAccount(uid);
    console.log("PASS repeat delete is a no-op");

    assert.deepEqual(await countRows(uid, false), othersBefore, "other users untouched");
    console.log("PASS other users untouched");
  } finally {
    // Also covers a seed that failed halfway.
    await deleteAccount(uid);
    await prisma.oAuthClient.deleteMany({ where: { id: clientId } });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("FAIL", e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });

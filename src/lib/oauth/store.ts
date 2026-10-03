import { randomBytes } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { Prisma, type OAuthClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { ClientMetadata } from "@/lib/oauth/cimd-document";
import {
  ACCESS_TTL_S,
  CODE_TTL_MS,
  REFRESH_TTL_S,
} from "@/lib/oauth/config";
import { OAuthError } from "@/lib/oauth/errors";
import { generateToken, hashToken } from "@/lib/oauth/tokens";
import type { ConnectedAppDTO } from "@/lib/types";

/**
 * Every Prisma access of the OAuth tables. Plaintext codes and tokens exist
 * only as return values here; nothing in this module logs or stores them.
 */

export type { OAuthClient };

/**
 * Two refreshes racing on the same token (a client retrying, or two tabs)
 * both deserve a fresh pair. A rotated-out token presented again inside this
 * window is served; after it, the presentation is a replay and revokes the
 * grant (OAuth 2.1 §4.3.1). Client races resolve in milliseconds, so the
 * window stays short to keep a stolen token's replay opportunity small.
 */
const REFRESH_REUSE_GRACE_MS = 3 * 1000;

/** `lastUsedAt` is informational; one write per grant per interval is plenty. */
const LAST_USED_RESOLUTION_MS = 5 * 60 * 1000;

const invalidGrant = () =>
  new OAuthError("invalid_grant", "the grant is invalid, expired, or revoked");

// --- clients ---------------------------------------------------------------

export function getClient(id: string): Promise<OAuthClient | null> {
  return prisma.oAuthClient.findUnique({ where: { id } });
}

export function upsertCimdClient(
  id: string,
  meta: ClientMetadata,
  document: unknown,
): Promise<OAuthClient> {
  const data = {
    kind: "cimd",
    name: meta.clientName,
    redirectUris: meta.redirectUris,
    document: document as Prisma.InputJsonValue,
    fetchedAt: new Date(),
  };
  return prisma.oAuthClient.upsert({
    where: { id },
    create: { id, ...data },
    update: data,
  });
}

export function createDcrClient(input: {
  name: string | null;
  redirectUris: string[];
  document: unknown;
}): Promise<OAuthClient> {
  return prisma.oAuthClient.create({
    data: {
      id: `dcr_${randomBytes(16).toString("base64url")}`,
      kind: "dcr",
      name: input.name,
      redirectUris: input.redirectUris,
      document: input.document as Prisma.InputJsonValue,
    },
  });
}

// --- authorization codes ---------------------------------------------------

export type ClaimedCode = {
  id: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  resource: string | null;
};

/** Returns the plaintext code; expired codes of the same user are pruned. */
export async function createCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  resource: string | null;
}): Promise<string> {
  const code = generateToken("ac");
  const now = new Date();
  await prisma.$transaction([
    prisma.oAuthCode.deleteMany({
      where: { userId: input.userId, expiresAt: { lt: now } },
    }),
    prisma.oAuthCode.create({
      data: {
        ...input,
        codeHash: hashToken(code),
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      },
    }),
  ]);
  return code;
}

/**
 * Marks the code used and returns it, atomically: the conditional update is
 * what makes a code single-use under concurrent exchanges. A code that was
 * already used revokes the grant it produced, because the second presenter
 * may be the one who stole it (OAuth 2.1 §4.1.2).
 */
export async function claimCode(code: string): Promise<ClaimedCode> {
  const codeHash = hashToken(code);
  const now = new Date();
  const claimed = await prisma.oAuthCode.updateMany({
    where: { codeHash, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count === 1) {
    const row = await prisma.oAuthCode.findUnique({
      where: { codeHash },
      select: {
        id: true,
        clientId: true,
        userId: true,
        redirectUri: true,
        scope: true,
        codeChallenge: true,
        resource: true,
      },
    });
    if (row) return row;
  }
  const stale = await prisma.oAuthCode.findUnique({
    where: { codeHash },
    select: { usedAt: true, grantId: true },
  });
  if (stale?.usedAt && stale.grantId) {
    await prisma.oAuthGrant.deleteMany({ where: { id: stale.grantId } });
  }
  throw new OAuthError(
    "invalid_grant",
    "authorization code is invalid, expired, or already used",
  );
}

// --- grants and tokens -----------------------------------------------------

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
};

function newTokenRows(grantId: string) {
  const access = generateToken("at");
  const refresh = generateToken("rt");
  const now = Date.now();
  return {
    access,
    refresh,
    rows: [
      {
        grantId,
        kind: "access",
        tokenHash: hashToken(access),
        expiresAt: new Date(now + ACCESS_TTL_S * 1000),
      },
      {
        grantId,
        kind: "refresh",
        tokenHash: hashToken(refresh),
        expiresAt: new Date(now + REFRESH_TTL_S * 1000),
      },
    ],
  };
}

/**
 * Issues the first pair of a grant. The code that produced it is linked in
 * the same transaction, so there is no moment at which the grant exists but
 * a replay of the code could not find it to revoke.
 */
export async function createGrantWithTokens(input: {
  userId: string;
  clientId: string;
  scope: string;
  codeId: string;
}): Promise<TokenPair & { grantId: string }> {
  const { codeId, ...grantData } = input;
  return prisma.$transaction(async (tx) => {
    const grant = await tx.oAuthGrant.create({ data: grantData });
    await tx.oAuthCode.update({
      where: { id: codeId },
      data: { grantId: grant.id },
    });
    const t = newTokenRows(grant.id);
    await tx.oAuthToken.createMany({ data: t.rows });
    return {
      grantId: grant.id,
      accessToken: t.access,
      refreshToken: t.refresh,
      expiresIn: ACCESS_TTL_S,
      scope: input.scope,
    };
  });
}

type RotationOutcome =
  | { kind: "issued"; pair: TokenPair }
  | { kind: "rejected" }
  | { kind: "replay"; grantId: string };

/**
 * Rotation: the presented refresh token is retired and a new pair issued.
 * The retired row is kept (with `revokedAt`) until it expires so a later
 * presentation is recognised as a replay rather than as an unknown token.
 *
 * A replay (or a token presented by the wrong client) revokes the whole
 * grant. That deletion happens outside the transaction below on purpose:
 * the transaction's job is to decide and to issue, and a decision that ends
 * in `invalid_grant` must not roll its own containment back with it.
 */
export async function rotateRefreshToken(
  refreshToken: string,
  clientId: string,
): Promise<TokenPair> {
  const tokenHash = hashToken(refreshToken);
  const outcome = await prisma.$transaction(
    async (tx): Promise<RotationOutcome> => {
      const now = new Date();
      const row = await tx.oAuthToken.findUnique({
        where: { tokenHash },
        include: { grant: true },
      });
      if (!row || row.kind !== "refresh" || row.expiresAt <= now) {
        return { kind: "rejected" };
      }
      if (row.grant.clientId !== clientId) {
        return { kind: "replay", grantId: row.grantId };
      }
      if (row.revokedAt) {
        const sinceRevoke = now.getTime() - row.revokedAt.getTime();
        if (sinceRevoke > REFRESH_REUSE_GRACE_MS) {
          return { kind: "replay", grantId: row.grantId };
        }
      } else {
        await tx.oAuthToken.update({
          where: { id: row.id },
          data: { revokedAt: now },
        });
      }
      await tx.oAuthToken.deleteMany({
        where: { grantId: row.grantId, expiresAt: { lt: now } },
      });
      const t = newTokenRows(row.grantId);
      await tx.oAuthToken.createMany({ data: t.rows });
      return {
        kind: "issued",
        pair: {
          accessToken: t.access,
          refreshToken: t.refresh,
          expiresIn: ACCESS_TTL_S,
          scope: row.grant.scope,
        },
      };
    },
  );

  if (outcome.kind === "issued") return outcome.pair;
  if (outcome.kind === "replay") await revokeGrantWithRetry(outcome.grantId);
  throw invalidGrant();
}

/**
 * Containment must not fail quietly: a replay has been detected and the
 * thief's chain is alive until this delete lands. Three attempts, then a
 * loud log line for whoever watches the function logs.
 */
async function revokeGrantWithRetry(grantId: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await prisma.oAuthGrant.deleteMany({ where: { id: grantId } });
      return;
    } catch (e) {
      lastError = e;
    }
  }
  console.error(`REPLAY DETECTED but grant ${grantId} could not be revoked:`, lastError);
}

/**
 * Bearer verification for `withMcpAuth`. `extra.userId` is the only source of
 * the user id for every tool; it comes from the grant, never from the client.
 */
export async function verifyAccessToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const row = await prisma.oAuthToken.findUnique({
    where: { tokenHash: hashToken(bearerToken) },
    include: {
      grant: {
        select: {
          id: true,
          userId: true,
          clientId: true,
          scope: true,
          lastUsedAt: true,
        },
      },
    },
  });
  if (!row || row.kind !== "access" || row.revokedAt) return undefined;
  const now = Date.now();
  if (row.expiresAt.getTime() <= now) return undefined;

  const lastUsed = row.grant.lastUsedAt?.getTime() ?? 0;
  if (now - lastUsed > LAST_USED_RESOLUTION_MS) {
    await prisma.oAuthGrant.update({
      where: { id: row.grant.id },
      data: { lastUsedAt: new Date(now) },
    });
  }

  return {
    token: bearerToken,
    clientId: row.grant.clientId,
    scopes: row.grant.scope.split(" "),
    expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
    extra: { userId: row.grant.userId, grantId: row.grant.id },
  };
}

// --- settings ----------------------------------------------------------------

function clientHost(client: OAuthClient): string | null {
  if (client.kind !== "cimd") return null;
  try {
    return new URL(client.id).hostname;
  } catch {
    return null;
  }
}

export async function listGrants(userId: string): Promise<ConnectedAppDTO[]> {
  const rows = await prisma.oAuthGrant.findMany({
    where: { userId },
    include: { client: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((g) => {
    const host = clientHost(g.client);
    return {
      id: g.id,
      name: g.client.name ?? host ?? "Registered app",
      host,
      kind: g.client.kind === "cimd" ? "cimd" : "dcr",
      scopes: g.scope.split(" "),
      createdAt: g.createdAt.toISOString(),
      lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
    };
  });
}

/** Deleting the grant cascades to its tokens; scoped so a user can only revoke their own. */
export async function revokeGrant(
  userId: string,
  grantId: string,
): Promise<boolean> {
  const { count } = await prisma.oAuthGrant.deleteMany({
    where: { id: grantId, userId },
  });
  return count > 0;
}

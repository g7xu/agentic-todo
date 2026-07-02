import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Server-only Prisma client over the Neon serverless driver (TDD §4).
 *
 * Uses the WebSocket pool adapter (not HTTP) because the bulk-tool and
 * review-apply batches run inside `prisma.$transaction()` and HTTP-mode Neon
 * does not support interactive transactions.
 *
 * A single instance is reused across hot reloads in dev to avoid exhausting
 * connections. Never import this from a Client Component — all DB access goes
 * through server actions / route handlers.
 */
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

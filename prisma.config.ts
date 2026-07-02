import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Next.js reads .env.local, but the Prisma CLI does not load it automatically,
// so load it here for `prisma migrate` / `prisma db` commands.
loadEnv({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations run against a DIRECT (unpooled) Neon connection; the pooled
    // DATABASE_URL is used by the runtime driver adapter (src/lib/db.ts).
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});

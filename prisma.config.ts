import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Next.js reads .env.local, but the Prisma CLI does not load it automatically,
// so load it here for `prisma migrate` / `prisma db` commands.
loadEnv({ path: ".env.local" });

/**
 * Neon scales an idle branch's compute to zero, and waking it can take longer
 * than the 5s Prisma allows for a connection by default — which is exactly how
 * a migration against a branch nobody has touched in a week dies with P1001
 * ("Can't reach database server") against a database that is perfectly fine.
 * Give the cold start room, unless the URL already says otherwise.
 */
function withConnectTimeout(url: string | undefined, seconds = 30) {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("connect_timeout")) {
      parsed.searchParams.set("connect_timeout", String(seconds));
    }
    return parsed.toString();
  } catch {
    // Not a URL we can parse — hand it back untouched and let Prisma complain.
    return url;
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations run against a DIRECT (unpooled) Neon connection; the pooled
    // DATABASE_URL is used by the runtime driver adapter (src/lib/db.ts).
    url: withConnectTimeout(process.env.DIRECT_URL ?? process.env.DATABASE_URL),
  },
});

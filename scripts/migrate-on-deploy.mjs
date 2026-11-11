/**
 * Applies pending migrations as part of a deploy — but only when a database is
 * actually configured.
 *
 * Preview builds inherit no database credentials (the Vercel env vars are
 * Production-scoped), and `prisma migrate deploy` treats a missing datasource
 * URL as a hard error, so it failed every preview build on a deploy that never
 * had a database to migrate in the first place. Skipping is the honest
 * outcome there; failing the build is not.
 *
 * Note this only guards a datasource that is absent. A datasource that is
 * present but broken still fails the build, which is what we want: shipping
 * code past a migration that didn't apply is how prod ends up running against
 * a schema it doesn't expect.
 */
import { spawnSync } from "node:child_process";
import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

// Same load as prisma.config.ts — the Prisma CLI doesn't read .env.local, so a
// local `npm run build` would otherwise look identical to an unconfigured
// preview and skip migrations it should run.
// `quiet` keeps dotenv's banner out of the build log and out of anything that
// captures this script's output.
loadEnv({ path: ".env.local", quiet: true });

// Same order as prisma.config.ts: DATABASE_URL_UNPOOLED is what Neon's Vercel
// integration sets for a preview's own branch (docs/PREVIEW-DATABASES.md).
const url =
  process.env.DIRECT_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!url) {
  console.log(
    "[migrate] no DIRECT_URL, DATABASE_URL_UNPOOLED or DATABASE_URL set — skipping `prisma migrate deploy`",
  );
  process.exit(0);
}

// npm puts node_modules/.bin on PATH for its own scripts, but this file is also
// runnable on its own — so put it there explicitly rather than depending on how
// it was invoked.
const binDir = fileURLToPath(new URL("../node_modules/.bin", import.meta.url));

const result = spawnSync("prisma", ["migrate", "deploy"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` },
});

process.exit(result.status ?? 1);

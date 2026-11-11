/**
 * Checks every prisma/migrations/<name>/migration.sql before anything runs it.
 *
 * `prisma migrate deploy` records a migration that fails as failed, and then
 * refuses to apply anything on that database until someone clears the record
 * by hand. So a migration that is broken in an obvious, textual way should be
 * caught here, in CI, before Vercel ever runs it.
 *
 * What it catches: a missing or empty migration.sql, and a line that is not
 * SQL at all, such as tool output captured by redirecting a CLI into the file
 * (dotenv's "◇ injected env" banner once landed at the top of a migration this
 * way). A line counts as suspect when it holds characters outside ASCII and is
 * not a `--` comment. Real SQL here is plain ASCII; comments may hold anything.
 *
 * Applying the migrations to a real Postgres (the CI workflow) catches the rest.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2] ?? fileURLToPath(new URL("../prisma/migrations", import.meta.url));

const problems = [];
const names = readdirSync(dir)
  .filter((name) => statSync(join(dir, name)).isDirectory())
  .sort();

for (const name of names) {
  const file = join(dir, name, "migration.sql");
  if (!existsSync(file)) {
    problems.push(`${name}: no migration.sql`);
    continue;
  }
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  if (lines.every((line) => line.trim() === "")) {
    problems.push(`${name}: migration.sql is empty`);
    continue;
  }
  lines.forEach((line, i) => {
    const code = line.split("--")[0];
    if (/[^\x00-\x7F]/.test(code)) {
      problems.push(`${name}/migration.sql:${i + 1}: not SQL? ${JSON.stringify(line.slice(0, 80))}`);
    }
  });
}

if (problems.length > 0) {
  console.error(`[check-migrations] ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`[check-migrations] ${names.length} migrations look like SQL`);

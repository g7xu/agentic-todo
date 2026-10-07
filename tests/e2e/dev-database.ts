/**
 * Neon endpoint ids the e2e scripts may write to. They delete users and
 * mint live tokens, so pointing one at production by accident must fail
 * before the first query. Add a host here or set E2E_ALLOW_DB_HOST.
 */
const ALLOWED_DB_ENDPOINTS = ["ep-spring-fire-at5o8npl"];

export function assertDevDatabase(): void {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const host = new URL(url).hostname;
  const allowed =
    ALLOWED_DB_ENDPOINTS.some((ep) => host.startsWith(ep)) ||
    process.env.E2E_ALLOW_DB_HOST === host;
  if (!allowed) {
    throw new Error(
      `refusing to write to ${host}: not a known development endpoint`,
    );
  }
}

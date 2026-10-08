/**
 * The e2e scripts delete users and mint live tokens, so pointing one at
 * production by accident must fail before the first query. They run only
 * against a database whose Neon endpoint id is listed in
 * `E2E_DEV_DB_ENDPOINTS` (comma-separated), or whose host is exactly
 * `E2E_ALLOW_DB_HOST`. With neither set, every script refuses.
 */
export function assertDevDatabase(): void {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const host = new URL(url).hostname;
  const endpoints = (process.env.E2E_DEV_DB_ENDPOINTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed =
    endpoints.some((ep) => host.startsWith(ep)) ||
    process.env.E2E_ALLOW_DB_HOST === host;
  if (!allowed) {
    throw new Error(
      `refusing to write to ${host}: list its endpoint id in E2E_DEV_DB_ENDPOINTS`,
    );
  }
}

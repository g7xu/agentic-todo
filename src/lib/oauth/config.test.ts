import { afterEach, describe, expect, it } from "vitest";
import { issuer, resourceUrl } from "@/lib/oauth/config";

const saved = { ...process.env };
function setEnv(vars: Record<string, string | undefined>) {
  for (const k of ["APP_URL", "VERCEL_ENV", "VERCEL_URL", "NODE_ENV"]) delete process.env[k];
  Object.assign(process.env, vars);
}
afterEach(() => {
  process.env = { ...saved };
});

describe("issuer", () => {
  it("prefers APP_URL and strips a trailing slash", () => {
    setEnv({ APP_URL: "https://todo.g7xu.dev/", NODE_ENV: "production" });
    expect(issuer()).toBe("https://todo.g7xu.dev");
    expect(resourceUrl()).toBe("https://todo.g7xu.dev/api/mcp");
  });

  it("uses the deployment URL on a Vercel preview", () => {
    setEnv({ VERCEL_ENV: "preview", VERCEL_URL: "guoxuan-todo-abc123.vercel.app", NODE_ENV: "production" });
    expect(issuer()).toBe("https://guoxuan-todo-abc123.vercel.app");
  });

  it("refuses to guess in production", () => {
    setEnv({ VERCEL_ENV: "production", VERCEL_URL: "guoxuan-todo.vercel.app", NODE_ENV: "production" });
    expect(() => issuer()).toThrow(/APP_URL/);
  });

  it("falls back to localhost in development", () => {
    setEnv({ NODE_ENV: "development" });
    expect(issuer()).toBe("http://localhost:3000");
  });
});

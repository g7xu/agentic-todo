import { describe, expect, it } from "vitest";
import {
  isRegistrableRedirectUri,
  redirectUriAllowed,
} from "@/lib/oauth/redirect-uri";

const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const CLAUDE_CODE = ["http://localhost/callback", "http://127.0.0.1/callback"];

describe("redirectUriAllowed", () => {
  it("matches a registered https URI exactly", () => {
    expect(redirectUriAllowed([CLAUDE], CLAUDE)).toBe(true);
    expect(redirectUriAllowed([CLAUDE], CLAUDE + "/")).toBe(false);
    expect(redirectUriAllowed([CLAUDE], "https://claude.ai/api/mcp/other")).toBe(false);
    expect(redirectUriAllowed([CLAUDE], "https://claude.ai.evil.com/api/mcp/auth_callback")).toBe(false);
  });

  it("ignores the port on loopback redirects", () => {
    expect(redirectUriAllowed(CLAUDE_CODE, "http://localhost:3118/callback")).toBe(true);
    expect(redirectUriAllowed(CLAUDE_CODE, "http://127.0.0.1:51234/callback")).toBe(true);
    expect(redirectUriAllowed(["http://[::1]/cb"], "http://[::1]:9/cb")).toBe(true);
  });

  it("still requires the same loopback host, path and query", () => {
    expect(redirectUriAllowed(["http://localhost/callback"], "http://127.0.0.1:3118/callback")).toBe(false);
    expect(redirectUriAllowed(CLAUDE_CODE, "http://localhost:3118/other")).toBe(false);
    expect(redirectUriAllowed(CLAUDE_CODE, "http://localhost:3118/callback?x=1")).toBe(false);
  });

  it("never applies the loopback rule to non-loopback hosts", () => {
    expect(redirectUriAllowed(["http://evil.localhost.attacker/callback"], "http://evil.localhost.attacker:81/callback")).toBe(false);
    expect(redirectUriAllowed(["https://localhost/callback"], "https://localhost:444/callback")).toBe(false);
    expect(redirectUriAllowed(CLAUDE_CODE, "not a url")).toBe(false);
  });
});

describe("isRegistrableRedirectUri", () => {
  it("accepts https and loopback http only", () => {
    expect(isRegistrableRedirectUri(CLAUDE)).toBe(true);
    expect(isRegistrableRedirectUri("http://localhost/callback")).toBe(true);
    expect(isRegistrableRedirectUri("http://example.com/callback")).toBe(false);
    expect(isRegistrableRedirectUri("https://example.com/cb#frag")).toBe(false);
    expect(isRegistrableRedirectUri("https://user:pw@example.com/cb")).toBe(false);
    expect(isRegistrableRedirectUri("/relative")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { decodeResume, resumeUrl } from "@/lib/oauth/resume";

const QUERY =
  "response_type=code&client_id=https%3A%2F%2Fclaude.ai%2Foauth%2Fclaude-code-client-metadata&redirect_uri=http%3A%2F%2Flocalhost%3A3118%2Fcallback&scope=tasks%3Aread+tasks%3Awrite&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256";

describe("resume", () => {
  it("round-trips the query through one safe parameter", () => {
    const url = resumeUrl(QUERY);
    expect(url).toMatch(/^\/oauth\/authorize\?r=[A-Za-z0-9_-]+$/);
    const token = new URL(url, "http://x").searchParams.get("r")!;
    expect(decodeResume(token)).toBe(`/oauth/authorize?${QUERY}`);
  });

  it("rejects values that are not base64url or decode to something unsafe", () => {
    expect(decodeResume("")).toBeNull();
    expect(decodeResume("not base64!")).toBeNull();
    expect(decodeResume(Buffer.from("a=1\nb=2").toString("base64url"))).toBeNull();
    expect(decodeResume(Buffer.from("a=1#frag").toString("base64url"))).toBeNull();
    expect(decodeResume(Buffer.from("").toString("base64url"))).toBeNull();
  });

  it("never yields an absolute URL", () => {
    const token = Buffer.from("//evil.example/x").toString("base64url");
    expect(decodeResume(token)).toBe("/oauth/authorize?//evil.example/x");
  });
});

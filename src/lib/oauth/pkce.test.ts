import { describe, expect, it } from "vitest";
import {
  isValidCodeChallenge,
  isValidCodeVerifier,
  s256Challenge,
  verifyS256,
} from "@/lib/oauth/pkce";

// RFC 7636 Appendix B test vector.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("pkce", () => {
  it("derives the RFC 7636 challenge", () => {
    expect(s256Challenge(VERIFIER)).toBe(CHALLENGE);
    expect(verifyS256(VERIFIER, CHALLENGE)).toBe(true);
  });

  it("rejects a wrong verifier", () => {
    expect(verifyS256(VERIFIER.slice(0, -1) + "x", CHALLENGE)).toBe(false);
  });

  it("rejects malformed inputs before hashing", () => {
    expect(isValidCodeVerifier("short")).toBe(false);
    expect(isValidCodeVerifier("a".repeat(129))).toBe(false);
    expect(isValidCodeVerifier("a".repeat(43) + "!")).toBe(false);
    expect(isValidCodeChallenge(CHALLENGE + "=")).toBe(false);
    expect(verifyS256("short", CHALLENGE)).toBe(false);
    expect(verifyS256(VERIFIER, "not-a-challenge")).toBe(false);
  });
});

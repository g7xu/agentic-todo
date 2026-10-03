import { createHash, timingSafeEqual } from "node:crypto";

/** RFC 7636 §4.1: 43–128 unreserved characters. */
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
/** base64url of a 32-byte SHA-256 digest, unpadded: always exactly 43 chars. */
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export function isValidCodeVerifier(verifier: string): boolean {
  return VERIFIER_RE.test(verifier);
}

export function isValidCodeChallenge(challenge: string): boolean {
  return CHALLENGE_RE.test(challenge);
}

export function s256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * True when `verifier` hashes to `challenge`. Malformed inputs are rejected
 * before hashing so the comparison always runs on equal-length buffers.
 */
export function verifyS256(verifier: string, challenge: string): boolean {
  if (!isValidCodeVerifier(verifier) || !isValidCodeChallenge(challenge)) {
    return false;
  }
  const expected = Buffer.from(s256Challenge(verifier));
  const actual = Buffer.from(challenge);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

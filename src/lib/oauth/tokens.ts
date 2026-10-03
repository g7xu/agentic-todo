import { createHash, randomBytes } from "node:crypto";

/** `at` access token, `rt` refresh token, `ac` authorization code. */
export type TokenPrefix = "at" | "rt" | "ac";

/** 256 bits of entropy; the prefix makes a leaked value identifiable in logs. */
export function generateToken(prefix: TokenPrefix): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

/** Only this digest is ever stored or looked up. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

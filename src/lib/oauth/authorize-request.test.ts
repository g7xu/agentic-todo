import { describe, expect, it } from "vitest";
import {
  parseAuthorizeRequest,
  parseRequestedScopes,
} from "@/lib/oauth/authorize-request";
import { OAuthError } from "@/lib/oauth/errors";

const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const valid = {
  response_type: "code",
  client_id: "https://claude.ai/oauth/claude-code-client-metadata",
  redirect_uri: "http://localhost:3118/callback",
  state: "abc",
  code_challenge: CHALLENGE,
  code_challenge_method: "S256",
};

describe("parseAuthorizeRequest", () => {
  it("accepts a well-formed request", () => {
    expect(parseAuthorizeRequest(valid)).toMatchObject(valid);
  });

  it("rejects plain PKCE and malformed challenges", () => {
    expect(() =>
      parseAuthorizeRequest({ ...valid, code_challenge_method: "plain" }),
    ).toThrow(OAuthError);
    expect(() =>
      parseAuthorizeRequest({ ...valid, code_challenge: "tooshort" }),
    ).toThrow(OAuthError);
  });

  it("rejects duplicate and missing parameters", () => {
    expect(() =>
      parseAuthorizeRequest({ ...valid, redirect_uri: ["a", "b"] }),
    ).toThrow(/duplicate/);
    const { client_id: _omitted, ...missing } = valid;
    void _omitted;
    expect(() => parseAuthorizeRequest(missing)).toThrow(/client_id/);
  });
});

describe("parseRequestedScopes", () => {
  it("defaults to every scope", () => {
    expect(parseRequestedScopes(undefined)).toEqual(["tasks:read", "tasks:write"]);
    expect(parseRequestedScopes("  ")).toEqual(["tasks:read", "tasks:write"]);
  });

  it("keeps a requested subset, dedupes, and drops offline_access", () => {
    expect(parseRequestedScopes("tasks:read tasks:read offline_access")).toEqual([
      "tasks:read",
    ]);
    expect(parseRequestedScopes("offline_access")).toEqual([
      "tasks:read",
      "tasks:write",
    ]);
  });

  it("rejects unknown scopes", () => {
    expect(() => parseRequestedScopes("tasks:read admin")).toThrow(/admin/);
  });
});

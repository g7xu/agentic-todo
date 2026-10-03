import { describe, expect, it } from "vitest";
import {
  isAllowedCimdUrl,
  validateClientMetadataDocument,
} from "@/lib/oauth/cimd-document";

const URL_ = "https://claude.ai/oauth/claude-code-client-metadata";

describe("isAllowedCimdUrl", () => {
  it("accepts public https URLs only", () => {
    expect(isAllowedCimdUrl(URL_)).toBe(true);
    expect(isAllowedCimdUrl("http://claude.ai/x")).toBe(false);
    expect(isAllowedCimdUrl("https://localhost/x")).toBe(false);
    expect(isAllowedCimdUrl("https://127.0.0.1/x")).toBe(false);
    expect(isAllowedCimdUrl("https://[::1]/x")).toBe(false);
    expect(isAllowedCimdUrl("https://db.internal/x")).toBe(false);
    expect(isAllowedCimdUrl("https://printer.local/x")).toBe(false);
    expect(isAllowedCimdUrl("https://u:p@claude.ai/x")).toBe(false);
    expect(isAllowedCimdUrl("https://claude.ai/x#frag")).toBe(false);
    expect(isAllowedCimdUrl("dcr_abc")).toBe(false);
  });
});

describe("validateClientMetadataDocument", () => {
  const doc = {
    client_id: URL_,
    client_name: "Claude Code",
    redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
    token_endpoint_auth_method: "none",
  };

  it("accepts a document whose client_id is its own URL", () => {
    expect(validateClientMetadataDocument(doc, URL_)).toEqual({
      clientName: "Claude Code",
      redirectUris: doc.redirect_uris,
    });
  });

  it("rejects a document claiming a different client_id", () => {
    expect(() =>
      validateClientMetadataDocument({ ...doc, client_id: "https://other/x" }, URL_),
    ).toThrow(/client_id/);
  });

  it("rejects confidential clients and bad redirect URIs", () => {
    expect(() =>
      validateClientMetadataDocument(
        { ...doc, token_endpoint_auth_method: "client_secret_basic" },
        URL_,
      ),
    ).toThrow(/malformed/);
    expect(() =>
      validateClientMetadataDocument(
        { ...doc, redirect_uris: ["http://example.com/cb"] },
        URL_,
      ),
    ).toThrow(/redirect_uris/);
    expect(() =>
      validateClientMetadataDocument({ ...doc, redirect_uris: [] }, URL_),
    ).toThrow(/malformed/);
  });
});

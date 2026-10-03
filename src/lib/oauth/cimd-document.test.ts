import { describe, expect, it } from "vitest";
import {
  isAllowedCimdUrl,
  isPublicAddress,
  validateClientMetadataDocument,
} from "@/lib/oauth/cimd-document";

const URL_ = "https://claude.ai/oauth/claude-code-client-metadata";

describe("isAllowedCimdUrl", () => {
  it("accepts public https URLs on the default port only", () => {
    expect(isAllowedCimdUrl(URL_)).toBe(true);
    expect(isAllowedCimdUrl("http://claude.ai/x")).toBe(false);
    expect(isAllowedCimdUrl("https://claude.ai:8443/x")).toBe(false);
    expect(isAllowedCimdUrl("https://localhost/x")).toBe(false);
    expect(isAllowedCimdUrl("https://localhost./x")).toBe(false);
    expect(isAllowedCimdUrl("https://intranet/x")).toBe(false);
    expect(isAllowedCimdUrl("https://127.0.0.1/x")).toBe(false);
    expect(isAllowedCimdUrl("https://[::1]/x")).toBe(false);
    expect(isAllowedCimdUrl("https://db.internal/x")).toBe(false);
    expect(isAllowedCimdUrl("https://db.internal./x")).toBe(false);
    expect(isAllowedCimdUrl("https://printer.local/x")).toBe(false);
    expect(isAllowedCimdUrl("https://1.0.0.10.in-addr.arpa/x")).toBe(false);
    expect(isAllowedCimdUrl("https://u:p@claude.ai/x")).toBe(false);
    expect(isAllowedCimdUrl("https://claude.ai/x#frag")).toBe(false);
    expect(isAllowedCimdUrl("dcr_abc")).toBe(false);
  });
});

describe("isPublicAddress", () => {
  it("refuses every reserved IPv4 range", () => {
    for (const ip of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
      "169.254.169.254", "100.64.0.1", "0.0.0.0", "192.0.0.1", "198.18.0.1",
      "224.0.0.1", "255.255.255.255",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("accepts ordinary public IPv4", () => {
    for (const ip of ["8.8.8.8", "104.18.32.7", "172.32.0.1", "100.128.0.1"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });

  it("refuses reserved IPv6 and mapped IPv4", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2001:db8::1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    expect(isPublicAddress("2606:4700::6812:2007")).toBe(true);
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
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

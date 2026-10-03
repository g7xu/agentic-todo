import { generateProtectedResourceMetadata } from "mcp-handler";
import { issuer, resourceUrl, SCOPES } from "@/lib/oauth/config";
import { jsonResponse } from "@/lib/oauth/http";

/** Discovery documents may be cached by clients for a few minutes. */
const METADATA_HEADERS = { "Cache-Control": "public, max-age=300" };

/**
 * RFC 8414 authorization server metadata. Two values decide how Claude
 * identifies itself: `client_id_metadata_document_supported` together with
 * `"none"` in `token_endpoint_auth_methods_supported` selects CIMD; without
 * both, clients fall back to `registration_endpoint`.
 */
export function authorizationServerMetadata() {
  const iss = issuer();
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/oauth/authorize`,
    token_endpoint: `${iss}/oauth/token`,
    registration_endpoint: `${iss}/oauth/register`,
    scopes_supported: [...SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
  };
}

/** RFC 9728 protected resource metadata for the MCP endpoint. */
export function protectedResourceMetadata() {
  return generateProtectedResourceMetadata({
    authServerUrls: [issuer()],
    resourceUrl: resourceUrl(),
    additionalMetadata: {
      scopes_supported: [...SCOPES],
      bearer_methods_supported: ["header"],
      resource_name: "Agentic Todoist",
    },
  });
}

export function authorizationServerMetadataResponse(): Response {
  return jsonResponse(authorizationServerMetadata(), {
    headers: METADATA_HEADERS,
  });
}

export function protectedResourceMetadataResponse(): Response {
  return jsonResponse(protectedResourceMetadata(), {
    headers: METADATA_HEADERS,
  });
}

import { jsonResponse, NO_STORE_HEADERS } from "@/lib/oauth/http";

/** RFC 6749 §5.2 error codes plus the MCP-relevant RFC 8707 `invalid_target`. */
export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "invalid_scope"
  | "invalid_target"
  | "invalid_client_metadata"
  | "invalid_redirect_uri"
  | "access_denied";

export class OAuthError extends Error {
  constructor(
    readonly code: OAuthErrorCode,
    description: string,
    readonly status: number = 400,
  ) {
    super(description);
    this.name = "OAuthError";
  }
}

/** The JSON error body RFC 6749 §5.2 prescribes for token-style endpoints. */
export function oauthErrorResponse(e: OAuthError): Response {
  return jsonResponse(
    { error: e.code, error_description: e.message },
    { status: e.status, headers: NO_STORE_HEADERS },
  );
}

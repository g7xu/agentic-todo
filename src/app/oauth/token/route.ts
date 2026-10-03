import { resourceUrl } from "@/lib/oauth/config";
import { OAuthError, oauthErrorResponse } from "@/lib/oauth/errors";
import { corsPreflight, jsonResponse, NO_STORE_HEADERS } from "@/lib/oauth/http";
import { isValidCodeVerifier, verifyS256 } from "@/lib/oauth/pkce";
import {
  claimCode,
  createGrantWithTokens,
  recordCodeGrant,
  rotateRefreshToken,
  type TokenPair,
} from "@/lib/oauth/store";

export const dynamic = "force-dynamic";

/**
 * RFC 6749 §3.2 token endpoint. Form-encoded only, because that is what every
 * OAuth client sends and a JSON body here would mean a client that never
 * read the spec. Public clients: a `client_secret` is refused outright.
 */
export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("application/x-www-form-urlencoded")) {
      return jsonResponse(
        {
          error: "invalid_request",
          error_description: "expected application/x-www-form-urlencoded",
        },
        { status: 415, headers: NO_STORE_HEADERS },
      );
    }
    const form = new URLSearchParams(await req.text());
    const param = (name: string): string | undefined => {
      const values = form.getAll(name);
      if (values.length > 1) {
        throw new OAuthError("invalid_request", `duplicate parameter: ${name}`);
      }
      return values[0];
    };

    if (param("client_secret") !== undefined) {
      throw new OAuthError("invalid_client", "this server issues no client secrets", 401);
    }
    const clientId = param("client_id");
    if (!clientId) throw new OAuthError("invalid_request", "client_id is required");

    let pair: TokenPair;
    switch (param("grant_type")) {
      case "authorization_code":
        pair = await exchangeCode({
          clientId,
          code: param("code"),
          redirectUri: param("redirect_uri"),
          codeVerifier: param("code_verifier"),
          resource: param("resource"),
        });
        break;
      case "refresh_token": {
        const refreshToken = param("refresh_token");
        if (!refreshToken) {
          throw new OAuthError("invalid_request", "refresh_token is required");
        }
        pair = await rotateRefreshToken(refreshToken, clientId);
        break;
      }
      default:
        throw new OAuthError("unsupported_grant_type", "use authorization_code or refresh_token");
    }

    return jsonResponse(
      {
        access_token: pair.accessToken,
        token_type: "Bearer",
        expires_in: pair.expiresIn,
        refresh_token: pair.refreshToken,
        scope: pair.scope,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (e) {
    if (e instanceof OAuthError) return oauthErrorResponse(e);
    throw e;
  }
}

async function exchangeCode(input: {
  clientId: string;
  code?: string;
  redirectUri?: string;
  codeVerifier?: string;
  resource?: string;
}): Promise<TokenPair> {
  const { clientId, code, redirectUri, codeVerifier, resource } = input;
  if (!code || !redirectUri || !codeVerifier) {
    throw new OAuthError(
      "invalid_request",
      "code, redirect_uri and code_verifier are required",
    );
  }
  if (!isValidCodeVerifier(codeVerifier)) {
    throw new OAuthError("invalid_request", "code_verifier is malformed");
  }

  // Claiming burns the code before any check below, so a mismatch leaves
  // nothing behind for a second attempt.
  const claimed = await claimCode(code);
  const bound =
    claimed.clientId === clientId &&
    claimed.redirectUri === redirectUri &&
    verifyS256(codeVerifier, claimed.codeChallenge);
  if (!bound) {
    throw new OAuthError("invalid_grant", "code is not bound to this request");
  }
  if (resource !== undefined && resource !== (claimed.resource ?? resourceUrl())) {
    throw new OAuthError("invalid_target", "resource does not match the authorization");
  }

  const grant = await createGrantWithTokens({
    userId: claimed.userId,
    clientId,
    scope: claimed.scope,
  });
  await recordCodeGrant(claimed.id, grant.grantId);
  return grant;
}

export function OPTIONS() {
  return corsPreflight();
}

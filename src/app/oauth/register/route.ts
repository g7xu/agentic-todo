import { z } from "zod";
import { OAuthError, oauthErrorResponse } from "@/lib/oauth/errors";
import { corsPreflight, jsonResponse, NO_STORE_HEADERS } from "@/lib/oauth/http";
import { isRegistrableRedirectUri } from "@/lib/oauth/redirect-uri";
import { createDcrClient } from "@/lib/oauth/store";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;

/**
 * RFC 7591 dynamic registration, public clients only. A request that asks
 * for anything this server does not issue (a secret, another grant type) is
 * refused rather than silently narrowed, so the client never believes it
 * holds a capability it does not.
 */
const registrationSchema = z.object({
  redirect_uris: z.array(z.string().max(2048)).min(1).max(10),
  client_name: z.string().trim().max(100).optional(),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .optional(),
  response_types: z.array(z.literal("code")).optional(),
});

/**
 * A display name is shown to a human on the consent page, so anything that
 * could disguise it is removed: control characters and the Unicode
 * bidirectional and zero-width controls that let "evil" render as "Claude".
 */
function printableName(name: string | undefined): string | null {
  const cleaned = name
    ?.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g, "")
    .trim();
  return cleaned ? cleaned : null;
}

export async function POST(req: Request) {
  try {
    if (!req.headers.get("content-type")?.includes("application/json")) {
      throw new OAuthError("invalid_client_metadata", "expected application/json");
    }
    if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) {
      throw new OAuthError("invalid_client_metadata", "request body too large", 413);
    }
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      throw new OAuthError("invalid_client_metadata", "request body too large");
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new OAuthError("invalid_client_metadata", "request body is not JSON");
    }
    const parsed = registrationSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new OAuthError(
        "invalid_client_metadata",
        `${issue?.path.join(".") || "body"}: ${issue?.message}`,
      );
    }
    if (!parsed.data.redirect_uris.every(isRegistrableRedirectUri)) {
      throw new OAuthError(
        "invalid_redirect_uri",
        "redirect_uris must be https or loopback http URLs without fragments",
      );
    }

    const client = await createDcrClient({
      name: printableName(parsed.data.client_name),
      redirectUris: parsed.data.redirect_uris,
      document: body,
    });
    return jsonResponse(
      {
        client_id: client.id,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
        client_name: client.name ?? undefined,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch (e) {
    if (e instanceof OAuthError) return oauthErrorResponse(e);
    throw e;
  }
}

export function OPTIONS() {
  return corsPreflight();
}

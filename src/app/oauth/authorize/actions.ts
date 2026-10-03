"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { ensureUserProvisioned } from "@/lib/provisioning";
import {
  parseAuthorizeRequest,
  parseRequestedScopes,
  type AuthorizeRequest,
} from "@/lib/oauth/authorize-request";
import { resourceUrl } from "@/lib/oauth/config";
import { OAuthError } from "@/lib/oauth/errors";
import { appendParams, redirectUriAllowed } from "@/lib/oauth/redirect-uri";
import { createCode, getClient } from "@/lib/oauth/store";

/**
 * The consent decision. This path sits outside the proxy's protection and
 * trusts nothing from the form: the session is re-checked, every field is
 * re-validated, and the client is re-read from the database (never fetched).
 */
async function validatedRequest(
  formData: FormData,
): Promise<{ request: AuthorizeRequest; scope: string }> {
  const fields: Record<string, string> = {
    response_type: "code",
    code_challenge_method: "S256",
  };
  for (const name of ["client_id", "redirect_uri", "state", "scope", "code_challenge", "resource"]) {
    const v = formData.get(name);
    if (typeof v === "string" && v !== "") fields[name] = v;
  }
  const request = parseAuthorizeRequest(fields);
  const client = await getClient(request.client_id);
  if (!client || !redirectUriAllowed(client.redirectUris, request.redirect_uri)) {
    throw new OAuthError("invalid_client", "client or redirect_uri is not registered");
  }
  if (request.resource !== undefined && request.resource !== resourceUrl()) {
    throw new OAuthError("invalid_target", "resource does not name this server");
  }
  // What the client asked for is what it gets, never more (RFC 6749 §3.3).
  const scope = parseRequestedScopes(request.scope).join(" ");
  return { request, scope };
}

export async function approveAuthorization(formData: FormData): Promise<void> {
  const user = await requireUser();
  const { request, scope } = await validatedRequest(formData);
  await ensureUserProvisioned(user.id, user.email);
  const code = await createCode({
    clientId: request.client_id,
    userId: user.id,
    redirectUri: request.redirect_uri,
    scope,
    codeChallenge: request.code_challenge,
    resource: request.resource ?? null,
  });
  redirect(appendParams(request.redirect_uri, { code, state: request.state }));
}

export async function denyAuthorization(formData: FormData): Promise<void> {
  await requireUser();
  const { request } = await validatedRequest(formData);
  redirect(
    appendParams(request.redirect_uri, {
      error: "access_denied",
      state: request.state,
    }),
  );
}

import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth/server";
import {
  parseAuthorizeRequest,
  parseRequestedScopes,
  type AuthorizeRequest,
} from "@/lib/oauth/authorize-request";
import { resolveCimdClient } from "@/lib/oauth/cimd";
import { resourceUrl, SCOPES, type Scope } from "@/lib/oauth/config";
import { OAuthError } from "@/lib/oauth/errors";
import { appendParams, redirectUriAllowed } from "@/lib/oauth/redirect-uri";
import { decodeResume, RESUME_PARAM, resumeUrl } from "@/lib/oauth/resume";
import { getClient, type OAuthClient } from "@/lib/oauth/store";
import { approveAuthorization, denyAuthorization } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SCOPE_COPY: Record<Scope, string> = {
  "tasks:read": "See your tasks, projects, routines and completion history",
  "tasks:write": "Add, edit, reschedule, complete and delete tasks and projects",
};

/**
 * OAuth 2.1 authorization endpoint (docs/MCP.md §3). Order matters:
 * malformed requests and unknown clients are shown here and never redirected,
 * because until the redirect_uri is proven registered it is an attacker's
 * URL; after that point errors go back to the client as the spec requires.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  // Returning from sign-in: unpack the request and re-enter with it.
  const resume = params[RESUME_PARAM];
  if (typeof resume === "string") {
    const target = decodeResume(resume);
    if (target) redirect(target);
    return (
      <ErrorCard
        error={new OAuthError("invalid_request", "resume token is malformed")}
      />
    );
  }

  let request: AuthorizeRequest;
  try {
    request = parseAuthorizeRequest(params);
  } catch (e) {
    return <ErrorCard error={asOAuthError(e)} />;
  }

  const { data: session } = await auth.getSession();
  if (!session?.user) {
    const present = Object.entries(request).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    );
    const back = resumeUrl(new URLSearchParams(present).toString());
    redirect(`/auth/sign-in?redirectTo=${encodeURIComponent(back)}`);
  }

  let client: OAuthClient | null;
  try {
    client = request.client_id.startsWith("https://")
      ? await resolveCimdClient(request.client_id)
      : await getClient(request.client_id);
  } catch (e) {
    return <ErrorCard error={asOAuthError(e)} />;
  }
  if (!client) {
    return (
      <ErrorCard error={new OAuthError("invalid_client", "unknown client")} />
    );
  }
  if (!redirectUriAllowed(client.redirectUris, request.redirect_uri)) {
    return (
      <ErrorCard
        error={
          new OAuthError(
            "invalid_redirect_uri",
            "redirect_uri is not registered for this client",
          )
        }
      />
    );
  }

  let clientError: OAuthError | null = null;
  try {
    parseRequestedScopes(request.scope);
  } catch (e) {
    clientError = asOAuthError(e);
  }
  if (!clientError && request.resource && request.resource !== resourceUrl()) {
    clientError = new OAuthError(
      "invalid_target",
      "resource does not name this server",
    );
  }
  if (clientError) {
    redirect(
      appendParams(request.redirect_uri, {
        error: clientError.code,
        error_description: clientError.message,
        state: request.state,
      }),
    );
  }

  const host = clientHost(client);
  const redirectHost = new URL(request.redirect_uri).host;
  const hidden = {
    client_id: request.client_id,
    redirect_uri: request.redirect_uri,
    state: request.state,
    scope: request.scope,
    code_challenge: request.code_challenge,
    resource: request.resource,
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">
          {client.name ?? host ?? "An application"} wants to connect
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {host ? (
            <>
              Identified by <span className="font-mono">{host}</span>.
            </>
          ) : (
            "Registered directly with this server."
          )}{" "}
          You are signed in as {session.user.email}.
        </p>

        <ul className="mt-5 space-y-2 text-sm">
          {SCOPES.map((s) => (
            <li key={s} className="flex gap-2">
              <span aria-hidden>✓</span>
              <span>{SCOPE_COPY[s]}</span>
            </li>
          ))}
        </ul>

        <p className="text-muted-foreground mt-5 text-xs">
          After you approve, you will be sent to{" "}
          <span className="font-mono">{redirectHost}</span>. Only connect if
          that is where you started.
        </p>

        <div className="mt-6 flex gap-2">
          <form action={approveAuthorization}>
            <HiddenFields fields={hidden} />
            <Button type="submit">Approve</Button>
          </form>
          <form action={denyAuthorization}>
            <HiddenFields fields={hidden} />
            <Button type="submit" variant="outline">
              Deny
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}

function HiddenFields({
  fields,
}: {
  fields: Record<string, string | undefined>;
}) {
  return (
    <>
      {Object.entries(fields).map(([name, value]) =>
        value === undefined ? null : (
          <input key={name} type="hidden" name={name} value={value} />
        ),
      )}
    </>
  );
}

function ErrorCard({ error }: { error: OAuthError }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">
          Connection request rejected
        </h1>
        <p className="mt-2 text-sm">
          <span className="font-mono">{error.code}</span>: {error.message}
        </p>
        <p className="text-muted-foreground mt-4 text-xs">
          Nothing was connected. Close this window and retry from your MCP
          client.
        </p>
      </div>
    </main>
  );
}

function clientHost(client: OAuthClient): string | null {
  if (client.kind !== "cimd") return null;
  try {
    return new URL(client.id).hostname;
  } catch {
    return null;
  }
}

function asOAuthError(e: unknown): OAuthError {
  return e instanceof OAuthError
    ? e
    : new OAuthError("invalid_request", "the request could not be processed");
}

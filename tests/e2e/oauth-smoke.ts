/**
 * End-to-end exercise of the OAuth 2.1 server and the MCP endpoint
 * (docs/MCP.md §4). Acts as a native MCP client: registers via DCR with a
 * loopback redirect, waits for the browser consent, exchanges the code with
 * PKCE, calls the MCP endpoint, then checks code reuse and refresh rotation.
 *
 *   npx tsx --tsconfig tsconfig.json tests/e2e/oauth-smoke.ts http://localhost:3000 [--cimd] [--keep]
 *
 * The consent step is interactive: the script opens the authorize URL in the
 * default browser (macOS) or prints it, then waits for the loopback callback.
 * The code-replay check runs last because it revokes the grant.
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
/** Identify as Claude Code through its published metadata document instead of registering. */
const useCimd = process.argv.includes("--cimd");
/** Skip the destructive checks so the grant stays visible under Settings → Connected apps. */
const keepGrant = process.argv.includes("--keep");
const CLAUDE_CODE_CLIENT_ID = "https://claude.ai/oauth/claude-code-client-metadata";

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (!cond) failures += 1;
  const suffix = !cond && detail !== undefined ? ` — ${JSON.stringify(detail)}` : "";
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${suffix}`);
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const out = await fn();
  console.log(`     ${label}: ${(performance.now() - start).toFixed(0)} ms`);
  return out;
}

async function getJson(path: string): Promise<Record<string, unknown>> {
  return (await (await fetch(`${base}${path}`)).json()) as Record<string, unknown>;
}

async function postForm(path: string, form: Record<string, string>) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

type Rpc = { jsonrpc: "2.0"; id: number; result?: unknown; error?: unknown };

/** One JSON-RPC call; the reply may arrive as JSON or as a single SSE event. */
async function mcp(token: string | null, method: string, params: unknown, id: number) {
  const res = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  let message: Rpc | undefined;
  try {
    if (res.headers.get("content-type")?.includes("text/event-stream")) {
      const data = text.split("\n").filter((l) => l.startsWith("data:")).pop();
      if (data) message = JSON.parse(data.slice(5)) as Rpc;
    } else if (text) {
      message = JSON.parse(text) as Rpc;
    }
  } catch {
    message = undefined;
  }
  return { status: res.status, headers: res.headers, message, text };
}

function listenLoopback(): Promise<{ port: number; callback: Promise<URL> }> {
  return new Promise((resolveListen) => {
    let server: Server;
    const callback = new Promise<URL>((resolveCallback) => {
      server = createServer((req, res) => {
        res.end("Approved. You can close this tab.");
        server.close();
        resolveCallback(new URL(req.url ?? "/", "http://127.0.0.1"));
      });
    });
    server!.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolveListen({ port, callback });
    });
  });
}

function toolText(reply: Rpc | undefined): string {
  const result = reply?.result as { content?: { text?: string }[] } | undefined;
  return result?.content?.[0]?.text ?? "";
}

async function main() {
  console.log(`target: ${base}\n`);

  // --- discovery (no credentials) ------------------------------------------
  const unauth = await mcp(null, "initialize", {}, 0);
  check("unauthenticated /api/mcp is 401", unauth.status === 401, unauth.status);
  const challenge = unauth.headers.get("www-authenticate") ?? "";
  check("401 carries resource_metadata", /resource_metadata="[^"]+"/.test(challenge), challenge);

  const prm = await getJson("/.well-known/oauth-protected-resource");
  check("protected resource names /api/mcp", prm.resource === `${base}/api/mcp`, prm);
  const suffixed = await getJson("/.well-known/oauth-protected-resource/api/mcp");
  check("path-suffixed document matches", suffixed.resource === prm.resource);

  const asm = await getJson("/.well-known/oauth-authorization-server");
  check(
    "authorization server advertises S256, CIMD, public clients",
    JSON.stringify(asm.code_challenge_methods_supported) === '["S256"]' &&
      asm.client_id_metadata_document_supported === true &&
      JSON.stringify(asm.token_endpoint_auth_methods_supported) === '["none"]',
    asm,
  );

  const tokenGet = await fetch(`${base}/oauth/token`, { redirect: "manual" });
  check("GET /oauth/token is not bounced to sign-in", ![301, 302, 307, 308].includes(tokenGet.status), tokenGet.status);

  // --- DCR + authorize ------------------------------------------------------
  const { port, callback } = await listenLoopback();
  let clientId: string;
  if (useCimd) {
    clientId = CLAUDE_CODE_CLIENT_ID;
    console.log(`ok   identifying as ${clientId} (CIMD, no registration)`);
  } else {
    const reg = await fetch(`${base}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "oauth-smoke",
        redirect_uris: ["http://127.0.0.1/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    const client = (await reg.json()) as { client_id?: string };
    check("DCR registers a client", reg.status === 201 && !!client.client_id, client);
    if (!client.client_id) return;
    clientId = client.client_id;
  }

  const verifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(8).toString("base64url");
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const authorizeUrl = `${base}/oauth/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: "tasks:read tasks:write offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    resource: `${base}/api/mcp`,
  })}`;
  console.log(`\nApprove in a browser where you are signed in:\n${authorizeUrl}\n`);
  if (process.platform === "darwin") spawn("open", [authorizeUrl], { stdio: "ignore" }).unref();
  const cb = await callback;
  check("callback state matches", cb.searchParams.get("state") === state);
  const code = cb.searchParams.get("code");
  check("callback carries a code", !!code, Object.fromEntries(cb.searchParams));
  if (!code) return;

  // --- token exchange -------------------------------------------------------
  const exchange = await timed("code exchange", () =>
    postForm("/oauth/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource: `${base}/api/mcp`,
    }),
  );
  check("exchange returns tokens", exchange.status === 200 && typeof exchange.body.access_token === "string", exchange.body);
  check("scope is both scopes", exchange.body.scope === "tasks:read tasks:write", exchange.body.scope);
  const access1 = String(exchange.body.access_token);
  const refresh1 = String(exchange.body.refresh_token);

  // --- MCP calls ------------------------------------------------------------
  const init = await mcp(
    access1,
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "oauth-smoke", version: "0" } },
    1,
  );
  check("initialize succeeds", init.status === 200 && !!init.message?.result, init.text.slice(0, 300));

  const tools = await mcp(access1, "tools/list", {}, 2);
  const names = ((tools.message?.result as { tools?: { name: string }[] })?.tools ?? []).map((t) => t.name);
  check("tools/list includes list_tasks and create_task", names.includes("list_tasks") && names.includes("create_task"), names);

  const projects = await mcp(access1, "tools/call", { name: "list_projects", arguments: {} }, 3);
  check("list_projects returns an Inbox", /"isInbox":true/.test(toolText(projects.message)), projects.text.slice(0, 200));

  const bad = await mcp(access1, "tools/call", { name: "delete_task", arguments: { id: "00000000-0000-4000-8000-000000000000" } }, 4);
  const badResult = bad.message?.result as { isError?: boolean } | undefined;
  check("deleting an unknown task is a readable tool error", badResult?.isError === true, bad.text.slice(0, 200));

  // --- refresh rotation -----------------------------------------------------
  const refreshed = await timed("refresh", () =>
    postForm("/oauth/token", { grant_type: "refresh_token", refresh_token: refresh1, client_id: clientId }),
  );
  check("refresh returns a new pair", refreshed.status === 200 && refreshed.body.refresh_token !== refresh1, refreshed.body);
  const access2 = String(refreshed.body.access_token);
  const refresh2 = String(refreshed.body.refresh_token);

  const graced = await postForm("/oauth/token", { grant_type: "refresh_token", refresh_token: refresh1, client_id: clientId });
  check("immediate replay of the old refresh token is tolerated (grace window)", graced.status === 200, graced.body);

  if (keepGrant) {
    console.log("\n--keep: skipping the revocation checks; the grant stays connected");
    console.log(failures === 0 ? "all checks passed" : `${failures} check(s) failed`);
    process.exitCode = failures === 0 ? 0 : 1;
    return;
  }

  // --- revocation: a replayed code kills everything it produced -------------
  // This must come last: after it the grant no longer exists.
  const reuse = await postForm("/oauth/token", {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
  check("reusing the code is invalid_grant", reuse.status === 400 && reuse.body.error === "invalid_grant", reuse.body);
  const after = await mcp(access2, "tools/list", {}, 5);
  check("the replayed code revoked the grant: access token is now 401", after.status === 401, after.status);
  const deadRefresh = await postForm("/oauth/token", { grant_type: "refresh_token", refresh_token: refresh2, client_id: clientId });
  check("and its refresh token is invalid_grant", deadRefresh.body.error === "invalid_grant", deadRefresh.body);

  console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Black-box end-to-end suite for the whole application, driven only through
 * HTTP: the unauthenticated surface (pages, /api/*, discovery documents), the
 * task/project/routine model through the MCP endpoint, protocol conformance,
 * and concurrency on the data model.
 *
 * Usage: npm run -s test:e2e:blackbox -- <fixtures.json>
 * (fixtures come from `npm run -s test:e2e:fixtures -- <owner email>`).
 *
 * Everything the suite creates is prefixed `[blackbox]` and deleted at the end,
 * even when scenarios fail. Projects have no delete tool, so a single
 * `[blackbox] project` is created once and reused on later runs.
 *
 * Output: one PASS / FAIL / NOTE line per scenario with an excerpt; exit code 1
 * when any scenario FAILs. NOTE records surprising-but-arguable behaviour.
 */

import { readFileSync } from "node:fs";

// ---------- fixtures ----------

type TokenSet = { access: string; refresh: string; grantId: string };
type Fixtures = {
  base: string;
  owner: { userId: string; taskId: string; inboxProjectId: string; tokens: { valid: TokenSet } };
  userB: { userId: string; taskId: string; inboxProjectId: string; tokens: { valid: TokenSet } };
  userC: { userId: string; tokens: { valid: TokenSet } };
  clientId: string;
};

const fixturesPath = process.argv[2];
if (!fixturesPath) {
  console.error("usage: app-blackbox.ts <fixtures.json>");
  process.exit(2);
}
const fx: Fixtures = JSON.parse(readFileSync(fixturesPath, "utf8"));
const BASE = fx.base.replace(/\/$/, "");
const OWNER = fx.owner.tokens.valid.access;
const PREFIX = "[blackbox]";
const RUN = Date.now().toString(36);
const TIMEOUT = 15_000;

// ---------- reporting ----------

type Verdict = "PASS" | "FAIL" | "NOTE";
const results: { verdict: Verdict; name: string; excerpt: string }[] = [];
let requestCount = 0;

function record(verdict: Verdict, name: string, excerpt: unknown) {
  const text = (typeof excerpt === "string" ? excerpt : JSON.stringify(excerpt)).replace(/\s*\n\s*/g, " ");
  const trimmed = text.length > 400 ? text.slice(0, 400) + "…" : text;
  results.push({ verdict, name, excerpt: trimmed });
  console.log(`${verdict} ${name} — ${trimmed}`);
}
const pass = (name: string, excerpt: unknown = "") => record("PASS", name, excerpt);
const fail = (name: string, excerpt: unknown) => record("FAIL", name, excerpt);
const note = (name: string, excerpt: unknown) => record("NOTE", name, excerpt);
function check(cond: boolean, name: string, excerpt: unknown) {
  (cond ? pass : fail)(name, excerpt);
}

// ---------- HTTP helpers ----------

type Resp = { status: number; headers: Headers; text: string; json: unknown };

const isConnectionDrop = (e: unknown) => /ECONNREFUSED|ECONNRESET|UND_ERR_SOCKET|fetch failed/.test(`${String(e)} ${(e as any)?.cause?.code ?? ""} ${(e as any)?.cause?.message ?? ""}`);
let reconnects = 0;

/**
 * Connection drops are retried (not timeouts or HTTP errors): the dev server
 * restarts itself on config changes and kills in-flight sockets, which is
 * environmental, not application behaviour. Each retry is counted and
 * reported as a NOTE so a flaky run is visible.
 */
async function http(path: string, init: RequestInit = {}): Promise<Resp> {
  requestCount++;
  const url = path.startsWith("http") ? path : BASE + path;
  let r: Response | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT), ...init });
      break;
    } catch (e) {
      if (!isConnectionDrop(e) || attempt >= 8) throw e;
      reconnects++;
      await new Promise((res) => setTimeout(res, 4000));
    }
  }
  const text = await r.text();
  let json: unknown = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: r.status, headers: r.headers, text, json };
}

/** Decodes a streamable-HTTP MCP reply: either a JSON body or a single SSE `data:` frame. */
function decodeMcp(resp: Resp): unknown {
  if (resp.json !== undefined) return resp.json;
  const line = resp.text.split("\n").find((l) => l.startsWith("data:"));
  if (!line) return undefined;
  try {
    return JSON.parse(line.replace(/^data:\s*/, ""));
  } catch {
    return undefined;
  }
}

let rpcId = 1;
async function rpcRaw(body: unknown, token: string | null = OWNER, headers: Record<string, string> = {}) {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...headers,
  };
  if (token) h.Authorization = `Bearer ${token}`;
  const resp = await http("/api/mcp", { method: "POST", headers: h, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { resp, msg: decodeMcp(resp) as any };
}

async function rpc(method: string, params: unknown = {}, token: string | null = OWNER) {
  return rpcRaw({ jsonrpc: "2.0", id: rpcId++, method, params }, token);
}

type ToolResult = {
  status: number;
  /** JSON-RPC level error (unknown tool etc.). */
  rpcError?: { code: number; message: string };
  /** Tool-level `isError` flag. */
  isError: boolean;
  text: string;
  data: any;
};

async function call(name: string, args: unknown = {}, token: string | null = OWNER): Promise<ToolResult> {
  const { resp, msg } = await rpc("tools/call", { name, arguments: args }, token);
  if (msg?.error) return { status: resp.status, rpcError: msg.error, isError: true, text: msg.error.message, data: undefined };
  const text = msg?.result?.content?.map((c: any) => c.text ?? "").join("\n") ?? resp.text;
  let data: any = undefined;
  try {
    data = JSON.parse(text);
  } catch {
    /* plain text result */
  }
  const isError = Boolean(msg?.result?.isError);
  if ((isError && internalLeakRe.test(text)) || resp.status >= 500) {
    fail(`internal error leaked by ${name}`, `HTTP ${resp.status} args=${JSON.stringify(args).slice(0, 120)} text=${text.slice(0, 300).replace(/\n/g, " ")}`);
  }
  return { status: resp.status, isError, text, data };
}

/** Tool error text that names runtime internals instead of a domain message. */
const internalLeakRe = /__TURBOPACK__|Invalid `|prisma\.|PrismaClient|node_modules|\.(ts|js|mjs):\d+:\d+|ECONNREFUSED|TypeError|ReferenceError/;

async function serverAlive(): Promise<boolean> {
  try {
    const r = await fetch(BASE + "/.well-known/oauth-protected-resource", { signal: AbortSignal.timeout(5000) });
    return r.status === 200;
  } catch {
    return false;
  }
}

// ---------- tracking what we create ----------

const createdTasks = new Set<string>();
const createdProjects = new Set<string>();

async function createTask(args: Record<string, unknown>) {
  const r = await call("create_task", args);
  if (r.data?.id) createdTasks.add(r.data.id);
  return r;
}

async function listTasks(status?: "active" | "completed") {
  const r = await call("list_tasks", status ? { status } : {});
  return r.data as { today: string; timezone: string; tasks: any[] };
}

async function findTask(id: string, status?: "active" | "completed") {
  const l = await listTasks(status);
  return l?.tasks?.find((t) => t.id === id);
}

const randomUuid = () => crypto.randomUUID();
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function addDays(ymd: string, n: number) {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const stackTraceRe = /(\s+at\s+\S+\s+\(.*\.(js|ts|mjs|cjs):\d+:\d+\))|node_modules\/|TypeError:|ReferenceError:|PrismaClient/;

// =====================================================================
// A. Unauthenticated surface
// =====================================================================

async function sectionA() {
  console.log("\n# A. Unauthenticated surface (no cookie, no token)");

  const pages = ["/", "/inbox", "/upcoming", "/routines", "/activity", "/settings", `/projects/${randomUuid()}`, "/projects/not-a-uuid"];
  const pageResults: Record<string, string> = {};
  let allRedirect = true;
  for (const p of pages) {
    const r = await http(p, { headers: { Accept: "text/html" } });
    const loc = r.headers.get("location") ?? "";
    pageResults[p] = `${r.status} -> ${loc}`;
    if (!(r.status >= 300 && r.status < 400 && /\/auth\/sign-in/.test(loc))) allRedirect = false;
    if (r.status >= 500) fail(`A page ${p} is 5xx`, pageResults[p]);
  }
  check(allRedirect, "A pages redirect to /auth/sign-in without a session", pageResults);

  const signIn = await http("/auth/sign-in", { headers: { Accept: "text/html" } });
  check(signIn.status === 200 && /<html/i.test(signIn.text), "A /auth/sign-in renders without a session", `${signIn.status} ${signIn.headers.get("content-type")}`);

  const apiRoutes = [
    "/api/tasks",
    "/api/projects",
    "/api/routines",
    "/api/routines/history",
    "/api/routines/history?days=999999",
    "/api/routines/history?days=-1",
    "/api/routines/history?days=abc",
    "/api/tasks?" + "q=" + "a".repeat(100 * 1024),
  ];
  const apiResults: Record<string, string> = {};
  let any200 = false;
  let any5xx = false;
  let all401Json = true;
  let anyStack = false;
  for (const p of apiRoutes) {
    const label = p.length > 60 ? p.slice(0, 40) + `…(${p.length} chars)` : p;
    const r = await http(p, { headers: { Accept: "application/json" } });
    const loc = r.headers.get("location");
    apiResults[label] = `${r.status}${loc ? " -> " + loc : ""} ct=${r.headers.get("content-type") ?? "-"}`;
    if (r.status === 200) any200 = true;
    if (r.status >= 500) any5xx = true;
    // A 100 KB query string is refused at the HTTP layer (431) before any route runs.
    const oversized = p.length > 60 && r.status === 431;
    if (!oversized && !(r.status === 401 && r.json !== undefined)) all401Json = false;
    if (stackTraceRe.test(r.text)) anyStack = true;
  }
  check(!any200 && !any5xx, "A /api/* without a session never returns 200 or 5xx", apiResults);
  check(all401Json, "A /api/* without a session returns 401 JSON (not an HTML redirect)", apiResults);
  check(!anyStack, "A /api/* responses contain no stack trace", "scanned " + apiRoutes.length + " responses");

  // A fetch client that follows redirects: what does /api/tasks look like then?
  {
    requestCount++;
    const r = await fetch(BASE + "/api/tasks", { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT) });
    const ct = r.headers.get("content-type") ?? "";
    const body = await r.text();
    if (r.status === 200 && /html/.test(ct)) {
      note("A /api/tasks followed-redirect ends on a 200 HTML page", `final ${r.status} ${ct} url=${r.url}`);
    } else {
      pass("A /api/tasks followed-redirect does not masquerade as 200 HTML", `final ${r.status} ${ct} url=${r.url} ${body.slice(0, 80)}`);
    }
  }

  // HTTP methods on the JSON routes without a session.
  const methodResults: Record<string, string> = {};
  let method5xx = false;
  for (const p of ["/api/tasks", "/api/projects", "/api/routines", "/api/routines/history"]) {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await http(p, { method: m, headers: { "Content-Type": "application/json", Accept: "application/json" }, body: "{}" });
      methodResults[`${m} ${p}`] = String(r.status);
      if (r.status >= 500) method5xx = true;
      if (r.status === 200) methodResults[`${m} ${p}`] += " (200!)";
      if (stackTraceRe.test(r.text)) methodResults[`${m} ${p}`] += " STACK";
    }
  }
  check(!method5xx && !Object.values(methodResults).some((v) => v.includes("200!") || v.includes("STACK")), "A PUT/PATCH/DELETE/POST on /api/* without a session: no 5xx, no 200, no stack", methodResults);

  // Discovery documents and static assets.
  const as = await http("/.well-known/oauth-authorization-server");
  const asDoc = as.json as any;
  check(as.status === 200 && asDoc?.issuer && asDoc?.authorization_endpoint && asDoc?.token_endpoint, "A /.well-known/oauth-authorization-server reachable and well-formed", { status: as.status, issuer: asDoc?.issuer, token: asDoc?.token_endpoint, reg: asDoc?.registration_endpoint });
  const pr = await http("/.well-known/oauth-protected-resource");
  const prDoc = pr.json as any;
  check(pr.status === 200 && prDoc?.resource === BASE + "/api/mcp" && Array.isArray(prDoc?.authorization_servers), "A /.well-known/oauth-protected-resource names /api/mcp as the resource", { status: pr.status, resource: prDoc?.resource, servers: prDoc?.authorization_servers, scopes: prDoc?.scopes_supported, bearer: prDoc?.bearer_methods_supported });
  check(asDoc?.issuer === BASE && prDoc?.authorization_servers?.includes(BASE), "A discovery docs agree on the issuer", { issuer: asDoc?.issuer, servers: prDoc?.authorization_servers });

  const asset = signIn.text.match(/(?:src|href)="(\/_next\/static\/[^"]+\.(?:js|css))"/)?.[1];
  if (asset) {
    const r = await http(asset);
    check(r.status === 200, "A static asset reachable without a session", `${asset.slice(0, 60)} -> ${r.status}`);
  } else {
    note("A no /_next/static asset found in sign-in HTML to probe", signIn.text.slice(0, 120));
  }
  const fav = await http("/favicon.ico");
  check(fav.status !== 500, "A /favicon.ico does not 5xx", String(fav.status));

  // Unauthenticated MCP and OAuth endpoints (lightly; mcp-abuse covers hardening).
  const noTok = await rpc("tools/list", {}, null);
  check(noTok.resp.status === 401 && noTok.resp.json !== undefined, "A /api/mcp without token -> 401 JSON", `${noTok.resp.status} ${noTok.resp.text.slice(0, 100)}`);
  const www = noTok.resp.headers.get("www-authenticate");
  (www ? pass : note)("A /api/mcp 401 carries WWW-Authenticate", www ?? "header absent");
  const unauthGet = await http("/api/mcp");
  check(unauthGet.status === 401 || unauthGet.status === 405, "A GET /api/mcp without token is 401/405", String(unauthGet.status));
  for (const p of ["/oauth/token", "/oauth/register"]) {
    const r = await http(p);
    check(r.status === 405 || r.status === 404 || r.status === 400, `A GET ${p} is rejected without 5xx`, String(r.status));
  }
  const tokEmpty = await http("/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "" });
  check(tokEmpty.status === 400 && tokEmpty.json !== undefined, "A POST /oauth/token with empty body -> 400 JSON", `${tokEmpty.status} ${tokEmpty.text.slice(0, 100)}`);
  const authz = await http("/oauth/authorize");
  check(authz.status >= 300 && authz.status < 500, "A GET /oauth/authorize without session is redirect/4xx, not 5xx", `${authz.status} -> ${authz.headers.get("location")}`);

  const big = await http("/api/mcp?" + "x=" + "b".repeat(100 * 1024), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: "{}" });
  check(big.status < 500, "A /api/mcp with 100 KB query string is not 5xx", String(big.status));

  // Security headers are informational.
  const hdrs = ["x-frame-options", "content-security-policy", "strict-transport-security", "x-content-type-options"].map((h) => `${h}=${signIn.headers.get(h) ?? "-"}`);
  note("A security headers on /auth/sign-in", hdrs.join(" "));
}

// =====================================================================
// B. Task model through MCP
// =====================================================================

let inboxId = "";
let projectId = "";
let today = "";

async function sectionB() {
  console.log("\n# B. Task model through MCP (owner token)");

  // Inbox discovery.
  const projects = await call("list_projects");
  const inbox = projects.data?.find?.((p: any) => p.isInbox);
  inboxId = inbox?.id ?? "";
  check(Boolean(inboxId) && inboxId === fx.owner.inboxProjectId && projects.data[0]?.isInbox === true, "B list_projects: Inbox first and matches fixtures", { first: projects.data?.[0]?.name, inboxId });

  // Reuse or create the [blackbox] project.
  const existing = projects.data?.find?.((p: any) => typeof p.name === "string" && p.name.startsWith(PREFIX));
  if (existing) {
    projectId = existing.id;
    note("B reusing existing [blackbox] project (no delete_project tool exists)", { id: projectId, name: existing.name });
  } else {
    const cp = await call("create_project", { name: `${PREFIX} project` });
    projectId = cp.data?.id ?? "";
    createdProjects.add(projectId);
    check(uuidRe.test(projectId) && cp.data?.name === `${PREFIX} project` && cp.data?.isInbox === false, "B create_project returns id/name/isInbox=false", cp.data ?? cp.text);
    const after = await call("list_projects");
    check(after.data?.some?.((p: any) => p.id === projectId), "B created project appears in list_projects", `count=${after.data?.length}`);
  }

  // today / timezone.
  const l0 = await listTasks();
  today = l0?.today ?? "";
  let tzOk = false;
  let tzToday = "";
  try {
    tzToday = new Intl.DateTimeFormat("en-CA", { timeZone: l0.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    tzOk = true;
  } catch {
    tzOk = false;
  }
  check(isoDate.test(today) && tzOk, "B list_tasks reports today as YYYY-MM-DD and an IANA timezone", { today, timezone: l0?.timezone });
  check(tzOk && Math.abs(new Date(today).getTime() - new Date(tzToday).getTime()) <= 86_400_000, "B list_tasks.today agrees with wall clock in that timezone", { today, computed: tzToday });
  check(Array.isArray(l0?.tasks) && l0.tasks.every((t: any) => uuidRe.test(t.id) && typeof t.content === "string" && [1, 2, 3, 4].includes(t.priority) && ["active", "completed"].includes(t.status) && uuidRe.test(t.projectId)), "B every listed task has id/content/priority/status/projectId", `count=${l0?.tasks?.length}`);
  const defaultHasCompleted = l0.tasks.some((t: any) => t.status === "completed");
  note("B list_tasks without status includes completed tasks too", `completed in default listing: ${defaultHasCompleted}`);

  // Full create and exact read-back.
  const full = {
    content: `${PREFIX} full ${RUN}`,
    description: "desc with\nnewline and 中文",
    priority: 2,
    dueDate: addDays(today, 7),
    deadline: addDays(today, 14),
    estimate: 45,
    timeUsed: 10,
    projectId: inboxId,
  };
  const cr = await createTask(full);
  const sent = Object.entries(full);
  const mismatchCreate = sent.filter(([k, v]) => cr.data?.[k] !== v).map(([k, v]) => `${k}: sent ${JSON.stringify(v)} got ${JSON.stringify(cr.data?.[k])}`);
  check(!cr.isError && mismatchCreate.length === 0 && cr.data?.status === "active", "B create_task echoes every field exactly as sent", mismatchCreate.length ? mismatchCreate : { id: cr.data?.id });
  const fullId = cr.data?.id;
  const back = await findTask(fullId, "active");
  const mismatchList = sent.filter(([k, v]) => back?.[k] !== v).map(([k, v]) => `${k}: sent ${JSON.stringify(v)} got ${JSON.stringify(back?.[k])}`);
  check(Boolean(back) && mismatchList.length === 0, "B list_tasks returns every field exactly as sent", mismatchList.length ? mismatchList : "all 8 fields match");
  check(typeof back?.createdAt === "string" && !Number.isNaN(Date.parse(back.createdAt)), "B createdAt is an ISO timestamp", back?.createdAt);
  check(!("completedAt" in (back ?? {})) || back.completedAt === null, "B active task has no completedAt", String(back?.completedAt));

  // Defaults.
  const def = await createTask({ content: `${PREFIX} defaults ${RUN}` });
  const d = def.data ?? {};
  check(d.priority === 4 && d.projectId === inboxId && d.status === "active" && d.dueDate == null && d.deadline == null && d.estimate == null && d.description == null, "B create_task defaults: priority 4, Inbox, active, no dates", d);
  const defNull = await createTask({ content: `${PREFIX} projectId null ${RUN}`, projectId: null });
  check(defNull.data?.projectId === inboxId, "B create_task with projectId:null lands in Inbox", defNull.data?.projectId);

  // Update each field individually; others untouched.
  const ignore = new Set(["updatedAt"]);
  const snapshot = (t: any) => Object.fromEntries(Object.entries(t ?? {}).filter(([k]) => !ignore.has(k)));
  let prev = snapshot(back);
  const updates: [string, unknown][] = [
    ["content", `${PREFIX} full renamed ${RUN}`],
    ["description", "new description"],
    ["priority", 1],
    ["dueDate", addDays(today, 1)],
    ["deadline", addDays(today, 30)],
    ["estimate", 90],
    ["timeUsed", 25],
    ["projectId", projectId],
  ];
  for (const [field, value] of updates) {
    const u = await call("update_task", { id: fullId, [field]: value });
    const now = snapshot(await findTask(fullId, "active"));
    const others = Object.keys({ ...prev, ...now }).filter((k) => k !== field && JSON.stringify(prev[k]) !== JSON.stringify(now[k]));
    check(!u.isError && now[field] === value && others.length === 0, `B update_task ${field} changes only ${field}`, others.length ? { changedOthers: others.map((k) => `${k}: ${JSON.stringify(prev[k])} -> ${JSON.stringify(now[k])}`) } : { [field]: now[field] });
    prev = now;
  }
  check(uuidRe.test(projectId) && prev.projectId === projectId, "B task moved into created project via update_task", prev.projectId);

  // null clears.
  for (const field of ["dueDate", "deadline", "estimate", "description", "timeUsed"]) {
    const u = await call("update_task", { id: fullId, [field]: null });
    const now = await findTask(fullId, "active");
    const cleared = now && (now[field] === null || now[field] === undefined);
    check(!u.isError && cleared, `B update_task ${field}:null clears it`, { response: u.isError ? u.text : "ok", readBack: now?.[field] });
  }

  // Create a task directly in the project.
  const inProj = await createTask({ content: `${PREFIX} in project ${RUN}`, projectId });
  check(inProj.data?.projectId === projectId, "B create_task with projectId lands in that project", inProj.data?.projectId);
  const bogusProj = await createTask({ content: `${PREFIX} bogus project ${RUN}`, projectId: randomUuid() });
  (bogusProj.isError ? pass : fail)("B create_task with unknown projectId is rejected", bogusProj.isError ? bogusProj.text : bogusProj.data);
  if (!bogusProj.isError && bogusProj.data?.projectId === inboxId) note("B unknown projectId silently fell back to Inbox", bogusProj.data);

  // Complete / uncomplete / delete lifecycle.
  const lc = await createTask({ content: `${PREFIX} lifecycle ${RUN}` });
  const lcId = lc.data?.id;
  const done = await call("complete_task", { id: lcId });
  check(!done.isError && done.data?.status === "completed" && typeof done.data?.completedAt === "string" && !Number.isNaN(Date.parse(done.data.completedAt)), "B complete_task sets status completed + completedAt", done.data ?? done.text);
  const inCompleted = await findTask(lcId, "completed");
  const inActive = await findTask(lcId, "active");
  check(Boolean(inCompleted) && !inActive, "B completed task listed under completed, not under active", { completed: Boolean(inCompleted), active: Boolean(inActive) });
  const again = await call("complete_task", { id: lcId });
  (again.isError ? note : pass)("B complete_task on an already-completed task", again.isError ? `error: ${again.text}` : `idempotent, completedAt=${again.data?.completedAt} (was ${done.data?.completedAt})`);
  if (!again.isError && again.data?.completedAt !== done.data?.completedAt) note("B re-completing moved completedAt", { first: done.data?.completedAt, second: again.data?.completedAt });
  const undo = await call("uncomplete_task", { id: lcId });
  const backActive = await findTask(lcId, "active");
  const stillCompleted = await findTask(lcId, "completed");
  check(!undo.isError && undo.data?.status === "active" && backActive && !stillCompleted && backActive.completedAt == null, "B uncomplete_task reverses completion", { status: undo.data?.status, completedAt: backActive?.completedAt, inCompletedList: Boolean(stillCompleted) });
  const undoAgain = await call("uncomplete_task", { id: lcId });
  (undoAgain.isError ? note : pass)("B uncomplete_task on an active task", undoAgain.isError ? `error: ${undoAgain.text}` : "idempotent");
  const del = await call("delete_task", { id: lcId });
  check(!del.isError && del.data?.deleted === true && del.data?.id === lcId, "B delete_task reports deleted:true", del.data ?? del.text);
  createdTasks.delete(lcId);
  const goneA = await findTask(lcId, "active");
  const goneC = await findTask(lcId, "completed");
  check(!goneA && !goneC, "B deleted task gone from both lists", { active: Boolean(goneA), completed: Boolean(goneC) });
  const del2 = await call("delete_task", { id: lcId });
  check(del2.isError && /not found/i.test(del2.text), "B deleting twice -> 'not found' error", del2.text);
  const upGone = await call("update_task", { id: lcId, content: "x" });
  check(upGone.isError, "B update_task on a deleted task is an error", upGone.text);
  const cmpRandom = await call("complete_task", { id: randomUuid() });
  check(cmpRandom.isError && cmpRandom.status === 200, "B complete_task on random uuid -> tool error, HTTP 200", cmpRandom.text);

  // Bulk operations.
  const b = await Promise.all([1, 2, 3].map((i) => createTask({ content: `${PREFIX} bulk ${i} ${RUN}` })));
  const bIds = b.map((r) => r.data?.id);
  const ghost = randomUuid();
  const target = addDays(today, 3);
  const rs = await call("bulk_reschedule", { ids: [...bIds, ghost], dueDate: target });
  const rsApplied: string[] = rs.data?.applied ?? [];
  const rsSkipped: any[] = rs.data?.skipped ?? [];
  const skippedIds = rsSkipped.map((s: any) => (typeof s === "string" ? s : s?.id));
  check(!rs.isError && bIds.every((id) => rsApplied.includes(id)) && skippedIds.includes(ghost) && !rsApplied.includes(ghost), "B bulk_reschedule applied=our ids, skipped=random uuid", rs.data ?? rs.text);
  const afterRs = await listTasks("active");
  check(bIds.every((id) => afterRs.tasks.find((t) => t.id === id)?.dueDate === target), "B bulk_reschedule read-back dueDate", target);
  note("B bulk skipped-entry shape", JSON.stringify(rsSkipped[0]));

  const bc = await call("bulk_complete", { ids: [bIds[0], bIds[1], ghost, bIds[0]] });
  const bcApplied: string[] = bc.data?.applied ?? [];
  check(!bc.isError && bcApplied.includes(bIds[0]) && bcApplied.includes(bIds[1]) && !bcApplied.includes(ghost), "B bulk_complete applied/skipped correct (with duplicate id in input)", bc.data ?? bc.text);
  note("B bulk_complete duplicate id appears in applied N times", String(bcApplied.filter((x) => x === bIds[0]).length));
  const afterBc = await listTasks("completed");
  check([bIds[0], bIds[1]].every((id) => afterBc.tasks.find((t) => t.id === id)?.status === "completed"), "B bulk_complete read-back status", "both completed");
  const bcAgain = await call("bulk_complete", { ids: [bIds[0]] });
  note("B bulk_complete on already-completed task", bcAgain.data ?? bcAgain.text);

  const bd = await call("bulk_delete", { ids: [...bIds, ghost] });
  const bdApplied: string[] = bd.data?.applied ?? [];
  check(!bd.isError && bIds.every((id) => bdApplied.includes(id)) && !bdApplied.includes(ghost), "B bulk_delete applied=our ids, skipped=random uuid", bd.data ?? bd.text);
  bIds.forEach((id) => createdTasks.delete(id));
  const afterBd = await listTasks();
  check(!bIds.some((id) => afterBd.tasks.some((t) => t.id === id)), "B bulk_delete read-back: all gone", "none remain");
  const bdOwnerFixture = await call("bulk_reschedule", { ids: [], dueDate: today });
  check(bdOwnerFixture.isError, "B bulk_reschedule with empty ids rejected", bdOwnerFixture.text);
  const tooMany = await call("bulk_complete", { ids: Array.from({ length: 101 }, () => randomUuid()) });
  check(tooMany.isError && tooMany.status === 200, "B bulk_complete with 101 ids rejected", tooMany.text.slice(0, 120));
  const hundred = await call("bulk_complete", { ids: Array.from({ length: 100 }, () => randomUuid()) });
  check(!hundred.isError && (hundred.data?.applied?.length ?? -1) === 0 && (hundred.data?.skipped?.length ?? -1) === 100, "B bulk_complete with 100 unknown ids: applied 0, skipped 100", { applied: hundred.data?.applied?.length, skipped: hundred.data?.skipped?.length });

  // Validation edge cases (all should be tool errors over HTTP 200, never 5xx).
  const vcases: [string, string, Record<string, unknown>][] = [
    ["whitespace-only content", "create_task", { content: "   \t " }],
    ["empty content", "create_task", { content: "" }],
    ["content 501 chars", "create_task", { content: PREFIX + " " + "x".repeat(501 - PREFIX.length - 1) }],
    ["description 5001 chars", "create_task", { content: `${PREFIX} d5001`, description: "y".repeat(5001) }],
    ["priority 0", "create_task", { content: `${PREFIX} p0`, priority: 0 }],
    ["priority 5", "create_task", { content: `${PREFIX} p5`, priority: 5 }],
    ["priority 2.5", "create_task", { content: `${PREFIX} p2.5`, priority: 2.5 }],
    ["priority '2' string", "create_task", { content: `${PREFIX} pstr`, priority: "2" }],
    ["estimate 1441", "create_task", { content: `${PREFIX} e1441`, estimate: 1441 }],
    ["estimate -1", "create_task", { content: `${PREFIX} e-1`, estimate: -1 }],
    ["timeUsed 6000", "create_task", { content: `${PREFIX} t6000`, timeUsed: 6000 }],
    ["dueDate 10/03/2026", "create_task", { content: `${PREFIX} slashdate`, dueDate: "10/03/2026" }],
    ["dueDate ISO datetime", "create_task", { content: `${PREFIX} isodt`, dueDate: "2026-10-03T00:00:00Z" }],
    ["projectId not a uuid", "create_task", { content: `${PREFIX} badproj`, projectId: "inbox" }],
    ["update_task id missing", "update_task", { content: "x" }],
    ["update_task id not uuid", "update_task", { id: "123", content: "x" }],
    ["list_tasks status bogus", "list_tasks", { status: "bogus" }],
    ["create_project empty name", "create_project", { name: "" }],
    ["create_project 121-char name", "create_project", { name: PREFIX + "z".repeat(121 - PREFIX.length) }],
    ["get_routine_history days 0", "get_routine_history", { days: 0 }],
    ["get_routine_history days 372", "get_routine_history", { days: 372 }],
  ];
  for (const [label, tool, args] of vcases) {
    const r = await call(tool, args);
    if (r.data?.id && tool === "create_task") createdTasks.add(r.data.id);
    if (r.data?.id && tool === "create_project") createdProjects.add(r.data.id);
    check(r.status === 200 && r.isError, `B validation: ${label} rejected`, r.isError ? r.text.slice(0, 140) : `ACCEPTED: ${JSON.stringify(r.data).slice(0, 140)}`);
  }

  // Calendar-invalid dates that match the regex.
  for (const bad of ["2026-13-45", "2026-02-30", "2026-00-10"]) {
    const r = await createTask({ content: `${PREFIX} baddate ${bad}`, dueDate: bad });
    if (r.isError) pass(`B calendar-invalid dueDate ${bad} rejected`, r.text.slice(0, 120));
    else fail(`B calendar-invalid dueDate ${bad} accepted`, { stored: r.data?.dueDate });
  }
  const farFuture = await createTask({ content: `${PREFIX} far future`, dueDate: "9999-12-31" });
  (farFuture.isError ? note : note)("B dueDate 9999-12-31", farFuture.isError ? `rejected: ${farFuture.text}` : `accepted, stored ${farFuture.data?.dueDate}`);
  const deadlineBefore = await createTask({ content: `${PREFIX} deadline before due`, dueDate: addDays(today, 10), deadline: addDays(today, 2) });
  note("B deadline earlier than dueDate", deadlineBefore.isError ? `rejected: ${deadlineBefore.text}` : `accepted (dueDate ${deadlineBefore.data?.dueDate}, deadline ${deadlineBefore.data?.deadline})`);
  const pastDue = await createTask({ content: `${PREFIX} past due`, dueDate: "2000-01-01" });
  note("B dueDate in the past", pastDue.isError ? `rejected: ${pastDue.text}` : "accepted");

  // Content round-trips.
  const trimmed = await createTask({ content: `   ${PREFIX} trim me   ` });
  if (trimmed.data?.content === `${PREFIX} trim me`) note("B leading/trailing whitespace is trimmed from content", JSON.stringify(trimmed.data.content));
  else if (trimmed.data?.content === `   ${PREFIX} trim me   `) note("B leading/trailing whitespace is preserved in content", JSON.stringify(trimmed.data.content));
  else fail("B whitespace-padded content neither trimmed nor preserved", trimmed.data ?? trimmed.text);
  const upWs = await call("update_task", { id: fullId, content: "   " });
  check(upWs.isError, "B update_task whitespace-only content rejected", upWs.text.slice(0, 120));

  const uni = `${PREFIX} 中文 émoji 🚀 👨‍👩‍👧 عربي ‏ עברית ñ`;
  const u1 = await createTask({ content: uni, description: "🙂".repeat(50) });
  const u1back = await findTask(u1.data?.id, "active");
  check(u1back?.content === uni && u1back?.description === "🙂".repeat(50), "B unicode/emoji content and description round-trip exactly", u1back?.content);
  const c500 = PREFIX + " " + "é".repeat(500 - PREFIX.length - 1);
  const u2 = await createTask({ content: c500 });
  check(!u2.isError && u2.data?.content === c500 && c500.length === 500, "B 500-char (multibyte) content accepted and round-trips", `len=${u2.data?.content?.length} isError=${u2.isError}`);
  const html = `${PREFIX} <script>alert(1)</script> & "quotes" 'single'`;
  const u3 = await createTask({ content: html });
  check(u3.data?.content === html, "B HTML-looking content stored verbatim (not escaped/stripped)", u3.data?.content);
  const nl = `${PREFIX} line1\nline2\ttab`;
  const u4 = await createTask({ content: nl });
  (u4.data?.content === nl ? pass : note)("B newline/tab inside content round-trips", JSON.stringify(u4.data?.content));
  const d5000 = await createTask({ content: `${PREFIX} d5000`, description: "y".repeat(5000) });
  check(!d5000.isError && d5000.data?.description?.length === 5000, "B 5000-char description accepted", `isError=${d5000.isError}`);

  // Unknown fields / no-op update.
  const extra = await createTask({ content: `${PREFIX} extra field`, foo: "bar" });
  note("B create_task with unknown field 'foo'", extra.isError ? `rejected: ${extra.text.slice(0, 100)}` : `accepted; echoed foo=${JSON.stringify(extra.data?.foo)}`);
  const noop = await call("update_task", { id: fullId });
  note("B update_task with only id (no fields)", noop.isError ? `error: ${noop.text.slice(0, 100)}` : "accepted, returns task");
  const upStatus = await call("update_task", { id: fullId, status: "completed" } as any);
  const upStatusBack = await findTask(fullId);
  check(upStatusBack?.status === "active", "B update_task cannot set status directly (stays active)", { response: upStatus.isError ? "error" : "accepted", status: upStatusBack?.status });

  // Routines.
  const routines = await call("list_routines");
  const rl = routines.data;
  check(Array.isArray(rl) && rl.every((r: any) => uuidRe.test(r.id) && typeof r.content === "string" && typeof r.cadence === "string" && typeof r.active === "boolean" && uuidRe.test(r.projectId) && typeof r.repeatEvery === "number" && typeof r.repeatUnit === "string"), "B list_routines shape: id/content/cadence/active/projectId/repeatEvery/repeatUnit", `count=${rl?.length} sample=${JSON.stringify(rl?.[0]?.cadence)}`);
  if (Array.isArray(rl) && rl.length) {
    const r0 = rl[0];
    const keys = Object.keys(r0).sort().join(",");
    note("B list_routines fields", keys);
  }

  const h1 = await call("get_routine_history", { days: 1 });
  check(!h1.isError && h1.data?.from === today && h1.data?.to === today, "B get_routine_history days:1 -> from=to=today", { from: h1.data?.from, to: h1.data?.to });
  const h84 = await call("get_routine_history", {});
  check(!h84.isError && h84.data?.to === today && h84.data?.from === addDays(today, -83), "B get_routine_history default = 84-day window ending today", { from: h84.data?.from, to: h84.data?.to, expectedFrom: addDays(today, -83) });
  const h371 = await call("get_routine_history", { days: 371 });
  check(!h371.isError && h371.data?.from === addDays(today, -370) && h371.data?.to === today, "B get_routine_history days:371 window", { from: h371.data?.from, to: h371.data?.to });
  const h84x = await call("get_routine_history", { days: 84 });
  check(JSON.stringify(h84x.data) === JSON.stringify(h84.data), "B get_routine_history days:84 identical to default", `${h84x.data?.from}..${h84x.data?.to}`);

  const hist = h371.data;
  const allRoutinesOk = Array.isArray(hist?.routines) && hist.routines.every((r: any) => typeof r.done === "number" && typeof r.missed === "number" && Array.isArray(r.days));
  check(allRoutinesOk, "B history routines carry done/missed/days", `routines=${hist?.routines?.length}`);
  const statuses = new Set<string>();
  let countsConsistent = true;
  let inWindow = true;
  for (const r of hist?.routines ?? []) {
    let done = 0;
    let missed = 0;
    for (const d of r.days) {
      statuses.add(d.status);
      if (d.status === "completed") done++;
      if (d.status === "missed") missed++;
      if (d.date < hist.from || d.date > hist.to) inWindow = false;
    }
    if (done !== r.done || missed !== r.missed) countsConsistent = false;
  }
  check(countsConsistent, "B history done/missed equal counts of day statuses", [...statuses].join(","));
  check(inWindow, "B history day dates all inside [from,to]", `${hist?.from}..${hist?.to}`);
  check(!hist?.routines?.some((r: any) => r.days.some((d: any) => d.date === today)), "B today never appears as a day outcome in history (day not over)", "no entry dated today");
  const idsFromList = new Set((rl ?? []).map((r: any) => r.id));
  check(hist?.routines?.every((r: any) => idsFromList.has(r.id)) && hist?.routines?.length === rl?.length, "B history lists the same routine ids as list_routines (incl. inactive)", `${hist?.routines?.length} vs ${rl?.length}`);

  // Explicit from/to and boundary behaviour.
  const from = addDays(today, -40);
  const to = addDays(today, -20);
  const hx = await call("get_routine_history", { from, to });
  check(!hx.isError && hx.data?.from === from && hx.data?.to === to, "B get_routine_history explicit from/to echoed", { from: hx.data?.from, to: hx.data?.to });
  const daysX = (hx.data?.routines ?? []).flatMap((r: any) => r.days.map((d: any) => d.date));
  const hasFrom = daysX.includes(from);
  const hasTo = daysX.includes(to);
  const outside = daysX.some((d: string) => d < from || d > to);
  check(!outside, "B explicit window: no outcomes outside [from,to]", `n=${daysX.length}`);
  (hasFrom && hasTo ? pass : note)("B explicit window boundaries inclusive (both endpoints present)", { hasFrom, hasTo, hint: hasFrom && hasTo ? "inclusive" : "no outcome on an endpoint (data gap or exclusive bound)" });
  const inv = await call("get_routine_history", { from: to, to: from });
  (inv.isError ? pass : note)("B get_routine_history from > to", inv.isError ? `rejected: ${inv.text.slice(0, 100)}` : `accepted: from=${inv.data?.from} to=${inv.data?.to} outcomes=${(inv.data?.routines ?? []).reduce((n: number, r: any) => n + r.days.length, 0)}`);
  const onlyFrom = await call("get_routine_history", { from });
  note("B get_routine_history with from only", onlyFrom.isError ? `error: ${onlyFrom.text.slice(0, 100)}` : `from=${onlyFrom.data?.from} to=${onlyFrom.data?.to}`);
  const onlyTo = await call("get_routine_history", { to });
  note("B get_routine_history with to only", onlyTo.isError ? `error: ${onlyTo.text.slice(0, 100)}` : `from=${onlyTo.data?.from} to=${onlyTo.data?.to}`);
  const both = await call("get_routine_history", { days: 3, from, to });
  note("B get_routine_history with days AND from/to", both.isError ? `error: ${both.text.slice(0, 100)}` : `from=${both.data?.from} to=${both.data?.to} (days ignored: ${both.data?.from === from})`);
  const huge = await call("get_routine_history", { from: "2000-01-01", to: today });
  (huge.isError ? note : note)("B get_routine_history explicit 26-year range", huge.isError ? `rejected: ${huge.text.slice(0, 100)}` : `accepted: from=${huge.data?.from} to=${huge.data?.to}`);
  const futureWin = await call("get_routine_history", { from: addDays(today, 1), to: addDays(today, 10) });
  note("B get_routine_history future window", futureWin.isError ? `rejected: ${futureWin.text.slice(0, 100)}` : `accepted, outcomes=${(futureWin.data?.routines ?? []).reduce((n: number, r: any) => n + r.days.length, 0)}`);

  // Routine-day tasks are read-only for dueDate/projectId. Use the task's own
  // current values so an accepted update changes nothing in the owner's data.
  const all = await listTasks();
  const routineTask = all.tasks.find((t) => t.routineId);
  if (!routineTask) {
    note("B no routine-day task in owner's data; read-only check skipped", "");
  } else {
    // A refusal here is conclusive. Acceptance is not: the value sent equals
    // the stored one, and sending a different one would mutate owner data.
    const ud = await call("update_task", { id: routineTask.id, dueDate: routineTask.dueDate });
    (ud.isError ? pass : note)("B update_task dueDate on routine-day task", ud.isError ? `refused: ${ud.text.slice(0, 120)}` : "accepted a same-value dueDate update (a changed value was not tried); bulk_reschedule refuses the same task regardless of value");
    const up = await call("update_task", { id: routineTask.id, projectId: routineTask.projectId });
    (up.isError ? pass : note)("B update_task projectId on routine-day task", up.isError ? `refused: ${up.text.slice(0, 120)}` : "accepted a same-value projectId update (a changed value was not tried)");
    const brs = await call("bulk_reschedule", { ids: [routineTask.id], dueDate: routineTask.dueDate });
    const skipped = (brs.data?.skipped ?? []).map((s: any) => (typeof s === "string" ? s : s?.id));
    check(!brs.isError && skipped.includes(routineTask.id) && !(brs.data?.applied ?? []).includes(routineTask.id), "B bulk_reschedule skips routine-day task", brs.data ?? brs.text);
    const uc = await call("update_task", { id: routineTask.id, priority: routineTask.priority });
    note("B update_task priority (same value) on routine-day task", uc.isError ? `refused: ${uc.text.slice(0, 100)}` : "accepted");
    const after = all.tasks.find((t) => t.id === routineTask.id);
    const now = (await listTasks()).tasks.find((t) => t.id === routineTask.id);
    check(JSON.stringify(after) === JSON.stringify(now), "B routine-day task unchanged after read-only probes", now?.content);
  }
}

// =====================================================================
// C. Protocol conformance and discovery consistency
// =====================================================================

async function sectionC() {
  console.log("\n# C. MCP protocol and discovery consistency");

  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "blackbox", version: "0" } });
  const ir = init.msg?.result;
  check(init.resp.status === 200 && typeof ir?.protocolVersion === "string" && ir?.serverInfo?.name && ir?.serverInfo?.version, "C initialize returns protocolVersion + serverInfo", { protocolVersion: ir?.protocolVersion, serverInfo: ir?.serverInfo });
  check(typeof ir?.instructions === "string" && /priority/i.test(ir.instructions) && /Inbox/.test(ir.instructions) && /deadline/i.test(ir.instructions) && /routine/i.test(ir.instructions), "C initialize instructions describe priority/Inbox/deadline/routines", ir?.instructions?.slice(0, 120));
  check(ir?.capabilities?.tools !== undefined, "C initialize advertises tools capability", ir?.capabilities);
  note("C Mcp-Session-Id header on initialize", init.resp.headers.get("mcp-session-id") ?? "absent (stateless)");

  const old = await rpc("initialize", { protocolVersion: "1999-01-01", capabilities: {}, clientInfo: { name: "blackbox", version: "0" } });
  note("C initialize with unsupported protocolVersion", old.msg?.error ? `error ${old.msg.error.code}: ${old.msg.error.message}` : `accepted, server answered ${old.msg?.result?.protocolVersion}`);

  const tl = await rpc("tools/list", {});
  const tools: any[] = tl.msg?.result?.tools ?? [];
  const names = tools.map((t) => t.name).sort();
  const expected = ["bulk_complete", "bulk_delete", "bulk_reschedule", "complete_task", "create_project", "create_task", "delete_task", "get_routine_history", "list_projects", "list_routines", "list_tasks", "uncomplete_task", "update_task"];
  check(JSON.stringify(names) === JSON.stringify(expected), "C tools/list exposes exactly the 13 known tools", names);
  check(tools.every((t) => t.inputSchema?.type === "object" && typeof t.description === "string" && t.description.length > 0), "C every tool has an object inputSchema and description", `tools=${tools.length}`);
  const writeTools = tools.filter((t) => /^(create|update|delete|complete|uncomplete|bulk)_/.test(t.name));
  check(writeTools.every((t) => Array.isArray(t.inputSchema.required) && t.inputSchema.required.length > 0), "C every write tool declares required inputs", writeTools.map((t) => `${t.name}:${t.inputSchema.required?.join("+")}`).join(" "));
  // Every tool listed answers tools/call (at least with a validation error, never an unknown-tool error).
  const unknownOnCall: string[] = [];
  for (const t of ["list_projects", "list_routines"]) {
    const r = await call(t, {});
    if (r.rpcError) unknownOnCall.push(t);
  }
  check(unknownOnCall.length === 0, "C listed read tools are callable", "list_projects, list_routines");

  const unknownTool = await call("no_such_tool", {});
  check(Boolean(unknownTool.rpcError) && unknownTool.status === 200, "C unknown tool -> JSON-RPC error", unknownTool.rpcError);
  const unknownMethod = await rpc("foo/bar", {});
  check(unknownMethod.msg?.error?.code === -32601, "C unknown method -> -32601", unknownMethod.msg?.error ?? unknownMethod.resp.text.slice(0, 100));
  const noArgs = await rpc("tools/call", { name: "create_task" });
  check(noArgs.resp.status === 200 && (noArgs.msg?.error || noArgs.msg?.result?.isError), "C tools/call without arguments -> error, not 5xx", noArgs.msg?.error ?? noArgs.msg?.result?.content?.[0]?.text?.slice(0, 100));

  const notif = await rpcRaw({ jsonrpc: "2.0", method: "notifications/initialized" });
  check(notif.resp.status === 202 && notif.resp.text === "", "C notification (no id) -> 202 with empty body", `${notif.resp.status} body=${JSON.stringify(notif.resp.text.slice(0, 50))}`);
  const strId = await rpcRaw({ jsonrpc: "2.0", id: "abc-123", method: "tools/list", params: {} });
  check(strId.msg?.id === "abc-123", "C string request id echoed back", strId.msg?.id);
  const badJson = await rpcRaw("{not json");
  check(badJson.resp.status < 500 && (badJson.msg?.error?.code === -32700 || badJson.resp.status === 400), "C malformed JSON body -> parse error / 400, not 5xx", `${badJson.resp.status} ${badJson.resp.text.slice(0, 100)}`);
  const noVersion = await rpcRaw({ id: 1, method: "tools/list", params: {} });
  note("C request without jsonrpc field", `${noVersion.resp.status} ${noVersion.resp.text.slice(0, 100)}`);
  const batch = await rpcRaw([
    { jsonrpc: "2.0", id: "b1", method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: "b2", method: "tools/list", params: {} },
  ]);
  note("C JSON-RPC batch array", `${batch.resp.status} ${batch.resp.text.slice(0, 120).replace(/\n/g, " ")}`);
  const acceptJsonOnly = await rpcRaw({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} }, OWNER, { Accept: "application/json" });
  note("C Accept: application/json only (no text/event-stream)", `${acceptJsonOnly.resp.status} ct=${acceptJsonOnly.resp.headers.get("content-type")} ${acceptJsonOnly.resp.text.slice(0, 80).replace(/\n/g, " ")}`);
  const noAccept = await rpcRaw({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} }, OWNER, { Accept: "" });
  note("C no Accept header", `${noAccept.resp.status} ${noAccept.resp.text.slice(0, 80).replace(/\n/g, " ")}`);

  // Bearer-token transport.
  const lower = await rpcRaw({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, null, { Authorization: `bearer ${OWNER}` });
  note("C lowercase 'bearer' scheme", `${lower.resp.status}`);
  requestCount++;
  const q = await fetch(`${BASE}/api/mcp?access_token=${encodeURIComponent(OWNER)}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }), signal: AbortSignal.timeout(TIMEOUT) });
  check(q.status === 401, "C token in query string is not accepted", String(q.status));
  const getAuthed = await http("/api/mcp", { headers: { Authorization: `Bearer ${OWNER}`, Accept: "text/event-stream" } }).catch((e) => ({ status: -1, text: String(e), headers: new Headers(), json: undefined }) as Resp);
  check(getAuthed.status !== 500, "C GET /api/mcp with token does not 5xx", `${getAuthed.status} ${getAuthed.text.slice(0, 80)}`);
  const delAuthed = await http("/api/mcp", { method: "DELETE", headers: { Authorization: `Bearer ${OWNER}` } });
  check(delAuthed.status < 500, "C DELETE /api/mcp with token does not 5xx", String(delAuthed.status));

  // Refresh grant with a throwaway user, then use the new access token.
  const rf = await http("/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: fx.userC.tokens.valid.refresh, client_id: fx.clientId }).toString() });
  const rfj = rf.json as any;
  if (rf.status === 400 && rfj?.error === "invalid_grant") {
    // Refresh tokens are single-use: a previous run with the same fixtures consumed this one.
    note("C refresh_token grant (userC) skipped: fixture refresh token already consumed by an earlier run (single-use rotation)", rfj.error_description ?? rf.text.slice(0, 120));
  } else {
    check(rf.status === 200 && typeof rfj?.access_token === "string" && rfj?.token_type?.toLowerCase() === "bearer", "C refresh_token grant (userC) -> new bearer token", { status: rf.status, keys: Object.keys(rfj ?? {}), expires_in: rfj?.expires_in });
  }
  if (rfj?.access_token) {
    const tlC = await rpc("tools/list", {}, rfj.access_token);
    check(tlC.msg?.result?.tools?.length === expected.length, "C refreshed token works on tools/list", `tools=${tlC.msg?.result?.tools?.length}`);
    note("C refresh rotates refresh_token", rfj.refresh_token ? (rfj.refresh_token === fx.userC.tokens.valid.refresh ? "same refresh token returned" : "new refresh token issued") : "no refresh_token in response");
  }
  // Protected-resource doc vs actual bearer method.
  const prDoc = (await http("/.well-known/oauth-protected-resource")).json as any;
  const methods: string[] = prDoc?.bearer_methods_supported ?? [];
  note("C bearer_methods_supported vs observed", `doc=${JSON.stringify(methods)} header=accepted query=${q.status === 401 ? "rejected" : "accepted"}`);
}

// =====================================================================
// D. Concurrency on the data model
// =====================================================================

async function sectionD() {
  console.log("\n# D. Concurrency");

  const content = `${PREFIX} parallel ${RUN}`;
  const par = await Promise.all(Array.from({ length: 10 }, () => createTask({ content })));
  const ids = par.map((r) => r.data?.id).filter(Boolean);
  const statuses = par.map((r) => r.status);
  check(ids.length === 10 && new Set(ids).size === 10 && statuses.every((s) => s === 200), "D 10 parallel create_task with same content -> 10 distinct tasks", { distinct: new Set(ids).size, statuses: [...new Set(statuses)] });
  const listed = await listTasks("active");
  check(ids.every((id) => listed.tasks.some((t) => t.id === id)), "D all 10 parallel-created tasks visible in list_tasks", `found ${ids.filter((id) => listed.tasks.some((t) => t.id === id)).length}/10`);

  // Overlapping bulk_complete.
  const [t1, t2, t3, t4] = ids;
  const [bA, bB] = await Promise.all([call("bulk_complete", { ids: [t1, t2, t3] }), call("bulk_complete", { ids: [t2, t3, t4] })]);
  const appliedUnion = new Set([...(bA.data?.applied ?? []), ...(bB.data?.applied ?? [])]);
  const completedNow = await listTasks("completed");
  const allDone = [t1, t2, t3, t4].every((id) => completedNow.tasks.some((t) => t.id === id && t.status === "completed"));
  check(bA.status === 200 && bB.status === 200 && !bA.isError && !bB.isError && allDone, "D parallel overlapping bulk_complete: no 5xx, all four completed", { A: bA.data, B: bB.data });
  check(appliedUnion.size === 4, "D union of applied ids across overlapping bulk_complete covers all four", `union=${appliedUnion.size}`);
  const overlapClaimedTwice = [t2, t3].filter((id) => (bA.data?.applied ?? []).includes(id) && (bB.data?.applied ?? []).includes(id));
  note("D overlapping ids claimed as applied by both calls", `${overlapClaimedTwice.length}/2`);

  // Concurrent field updates on one task: both should land.
  const [t5] = ids.slice(4);
  const [uA, uB] = await Promise.all([call("update_task", { id: t5, priority: 1 }), call("update_task", { id: t5, description: "from B" })]);
  const t5now = await findTask(t5, "active");
  check(!uA.isError && !uB.isError && t5now?.priority === 1 && t5now?.description === "from B", "D parallel updates of different fields both land (no lost update)", { priority: t5now?.priority, description: t5now?.description });

  // Parallel reads.
  const reads = await Promise.all(Array.from({ length: 10 }, () => rpc("tools/list", {})));
  check(reads.every((r) => r.resp.status === 200 && r.msg?.result?.tools), "D 10 parallel tools/list all succeed", [...new Set(reads.map((r) => r.resp.status))]);

  // Parallel delete of the same id: exactly one should report deleted.
  const [t6] = ids.slice(5);
  const dels = await Promise.all([call("delete_task", { id: t6 }), call("delete_task", { id: t6 }), call("delete_task", { id: t6 })]);
  const deletedCount = dels.filter((d) => d.data?.deleted === true).length;
  check(dels.every((d) => d.status === 200) && deletedCount >= 1 && !(await findTask(t6)), "D 3 parallel deletes of one task: no 5xx, task gone", { deletedTrue: deletedCount, errors: dels.filter((d) => d.isError).length });
  (deletedCount === 1 ? pass : note)("D exactly one of the parallel deletes reports deleted:true", `deletedTrue=${deletedCount}`);
  createdTasks.delete(t6);

  // complete vs delete race on one task. This runs last because an earlier
  // run took the dev server down here; everything else is cleaned up first so
  // at most the race task can be left behind.
  const sweep = [...createdTasks];
  if (sweep.length) {
    const r = await call("bulk_delete", { ids: sweep.slice(0, 100) });
    (r.data?.applied ?? []).forEach((id: string) => createdTasks.delete(id));
  }
  const race = await createTask({ content: `${PREFIX} race ${RUN}` });
  const raceId = race.data?.id;
  let c: ToolResult | undefined;
  let dl: ToolResult | undefined;
  let raceErr: unknown;
  try {
    [c, dl] = await Promise.all([call("complete_task", { id: raceId }), call("delete_task", { id: raceId })]);
  } catch (e) {
    raceErr = e;
  }
  const alive = await serverAlive();
  check(alive, "D dev server still reachable after parallel complete + delete", alive ? "alive" : `UNREACHABLE after the race (${String(raceErr ?? "requests completed, then the process exited")})`);
  if (!alive) return;
  const finalA = await findTask(raceId, "active");
  const finalC = await findTask(raceId, "completed");
  const finalState = finalA ? "active(!)" : finalC ? "completed" : "deleted";
  check(c!.status === 200 && dl!.status === 200 && finalState !== "active(!)", "D parallel complete + delete: no 5xx, final state is completed or deleted", { complete: c!.isError ? `err:${c!.text.slice(0, 200)}` : "ok", delete: dl!.isError ? `err:${dl!.text.slice(0, 200)}` : "ok", finalState });
  // Raw database text in the error is caught as a FAIL inside call(); here only the wording is judged.
  const loserText = c!.isError ? c!.text.slice(0, 300) : "";
  (!c!.isError || /not found/i.test(loserText) ? pass : note)("D losing side of the race gets a domain 'not found' error", c!.isError ? `complete_task error text: ${loserText}` : "complete won; no error");
  if (finalState === "deleted") createdTasks.delete(raceId);
}

// =====================================================================
// E. Odds and ends worth pinning
// =====================================================================

async function sectionE() {
  console.log("\n# E. Other observed behaviour");

  // Ordering of list_tasks.
  const l = await listTasks();
  const firstCompletedIdx = l.tasks.findIndex((t) => t.status === "completed");
  const lastActiveIdx = l.tasks.map((t) => t.status).lastIndexOf("active");
  note("E list_tasks ordering", firstCompletedIdx === -1 ? "no completed tasks listed" : lastActiveIdx < firstCompletedIdx ? "all active before all completed" : "active and completed interleaved");
  const completedOnly = await listTasks("completed");
  check(completedOnly.tasks.every((t) => t.status === "completed"), "E list_tasks status:completed contains only completed", `n=${completedOnly.tasks.length}`);
  const activeOnly = await listTasks("active");
  check(activeOnly.tasks.every((t) => t.status === "active"), "E list_tasks status:active contains only active", `n=${activeOnly.tasks.length}`);
  check(activeOnly.tasks.length + completedOnly.tasks.length === l.tasks.length, "E active + completed == default listing", `${activeOnly.tasks.length}+${completedOnly.tasks.length} vs ${l.tasks.length}`);
  const oldest = completedOnly.tasks.map((t) => t.completedAt).filter(Boolean).sort()[0];
  note("E oldest completedAt in 'recently completed'", oldest ?? "none");

  // Field presence conventions.
  const sample = activeOnly.tasks.find((t) => t.content.startsWith(PREFIX)) ?? activeOnly.tasks[0];
  note("E task object keys (sample)", Object.keys(sample ?? {}).sort().join(","));
  const nullish = Object.entries(sample ?? {}).filter(([, v]) => v === null).map(([k]) => k);
  note("E null-valued keys vs absent keys on a sample task", nullish.length ? `null keys: ${nullish.join(",")}` : "no null keys; unset fields are omitted");

  // Latency / large payload.
  const t0 = Date.now();
  const bigDesc = await createTask({ content: `${PREFIX} 1MB desc`, description: "z".repeat(1024 * 1024) });
  check(bigDesc.status === 200 && bigDesc.isError, "E 1 MB description rejected by validation (HTTP 200, tool error)", `${Date.now() - t0}ms ${bigDesc.isError ? bigDesc.text.slice(0, 80) : "ACCEPTED"}`);
  const t1 = Date.now();
  await listTasks();
  note("E list_tasks latency", `${Date.now() - t1}ms for ${l.tasks.length} tasks`);

  // Cross-user tokens see different todays only if timezones differ; just record both.
  const lB = await call("list_tasks", {}, fx.userB.tokens.valid.access);
  note("E userB list_tasks today/timezone", { today: lB.data?.today, timezone: lB.data?.timezone });
  check(lB.data?.tasks?.every((t: any) => !t.content.startsWith(PREFIX)), "E userB never sees [blackbox] tasks created by owner", `n=${lB.data?.tasks?.length}`);

  // Duplicate project names. Projects cannot be deleted through MCP, so this
  // is probed only once: later runs read the answer from list_projects.
  const pName = `${PREFIX} project`;
  const projs = (await call("list_projects")).data ?? [];
  const sameName = projs.filter((p: any) => p.name === pName);
  if (sameName.length >= 2) {
    note("E duplicate project names allowed (two '[blackbox] project' entries exist from an earlier run)", sameName.map((p: any) => p.id));
  } else {
    const dupe = await call("create_project", { name: pName });
    if (dupe.data?.id) {
      createdProjects.add(dupe.data.id);
      note("E duplicate project name allowed (second '[blackbox] project' created; cannot be deleted via MCP)", dupe.data.id);
    } else {
      note("E duplicate project name rejected", dupe.text.slice(0, 100));
    }
  }
}

// ---------- cleanup ----------

async function cleanup() {
  console.log("\n# cleanup");
  try {
    const all = await listTasks();
    const stray = (all?.tasks ?? []).filter((t) => typeof t.content === "string" && t.content.trim().startsWith(PREFIX)).map((t) => t.id);
    const ids = [...new Set([...createdTasks, ...stray])];
    let deleted = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const r = await call("bulk_delete", { ids: ids.slice(i, i + 100) });
      deleted += r.data?.applied?.length ?? 0;
    }
    const after = await listTasks();
    const remaining = (after?.tasks ?? []).filter((t) => t.content?.startsWith(PREFIX));
    check(remaining.length === 0, "cleanup all [blackbox] tasks deleted", { deleted, remaining: remaining.length });
    if (createdProjects.size) note("cleanup [blackbox] projects left behind (no delete tool)", [...createdProjects]);
  } catch (e) {
    const pending = [...createdTasks];
    fail("cleanup threw", `${String(e)}; ${pending.length} [blackbox] task id(s) may remain (next run sweeps them): ${pending.join(",")}`);
  }
}

// ---------- main ----------

async function main() {
  console.log(`app-blackbox against ${BASE} run=${RUN}`);
  if (!(await serverAlive())) {
    console.error(`FAIL server at ${BASE} is not reachable; start the dev server first`);
    process.exit(1);
  }
  const auth = await rpc("tools/list", {});
  if (auth.resp.status !== 200) {
    console.error(`FAIL owner token rejected before any scenario ran: ${auth.resp.status} ${auth.resp.text.slice(0, 200)} — regenerate fixtures`);
    process.exit(1);
  }
  // D runs last: its complete/delete race is the one scenario known to be able to take the server down.
  const sections: [string, () => Promise<void>][] = [
    ["A", sectionA],
    ["B", sectionB],
    ["C", sectionC],
    ["E", sectionE],
    ["D", sectionD],
  ];
  for (const [name, fn] of sections) {
    try {
      await fn();
    } catch (e) {
      const cause = (e as any)?.cause?.code ?? "";
      fail(`${name} section threw`, `${String(e)} ${cause}`.trim() + (cause === "ECONNREFUSED" ? " (dev server is down)" : ""));
      if (!(await serverAlive())) {
        fail("server unreachable; remaining sections skipped", BASE);
        break;
      }
    }
  }
  await cleanup();
  if (reconnects) note("connection drops retried during the run (dev server restarted underneath the suite)", String(reconnects));

  const counts = { PASS: 0, FAIL: 0, NOTE: 0 };
  for (const r of results) counts[r.verdict]++;
  console.log(`\n# summary: PASS=${counts.PASS} FAIL=${counts.FAIL} NOTE=${counts.NOTE} requests=${requestCount}`);
  if (counts.FAIL) {
    console.log("\n# failures");
    for (const r of results.filter((x) => x.verdict === "FAIL")) console.log(`- ${r.name}: ${r.excerpt}`);
  }
  process.exit(counts.FAIL ? 1 : 0);
}

main().catch((e) => {
  console.error("fatal", e);
  process.exit(1);
});

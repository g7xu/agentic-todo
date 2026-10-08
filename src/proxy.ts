import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { AUTHORIZE_PATH, resumeUrl } from "@/lib/oauth/resume";

/**
 * Next.js 16 middleware. The file MUST live at `src/proxy.ts` in this project:
 * with a `src/` layout Next only discovers the proxy file next to `app/`; at
 * the repo root it is silently ignored — no route protection AND no OAuth
 * verifier exchange, which breaks Google sign-in entirely.
 *
 * Redirects unauthenticated users on matched routes to the sign-in page,
 * refreshes the session cookie, and exchanges the `neon_auth_session_verifier`
 * returned by the OAuth flow for a session.
 */
const LOGIN_URL = "/auth/sign-in";
const neonMiddleware = auth.middleware({ loginUrl: LOGIN_URL });

/**
 * An MCP client parks its entire OAuth request in the authorize URL's query
 * string. Neon's login redirect carries no return path, so this route alone
 * gets one (packed by `resumeUrl`); every other page lands on the default
 * view after sign-in.
 */
const RETURN_PATH_ROUTE = AUTHORIZE_PATH;

function isLoginRedirect(res: Response): boolean {
  if (res.status < 300 || res.status >= 400) return false;
  const location = res.headers.get("location");
  if (!location) return false;
  try {
    return new URL(location, "http://placeholder").pathname === LOGIN_URL;
  } catch {
    return false;
  }
}

/** A JSON client cannot act on a redirect to a sign-in page; it needs a 401. */
function unauthorizedJson(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export default async function proxy(req: NextRequest) {
  const isApi = req.nextUrl.pathname.startsWith("/api/");

  if (req.method === "GET") {
    const decision = await neonMiddleware(req);
    if (isLoginRedirect(decision)) {
      if (isApi) return unauthorizedJson();
      if (req.nextUrl.pathname === RETURN_PATH_ROUTE) {
        const back = resumeUrl(req.nextUrl.search.replace(/^\?/, ""));
        const login = `${LOGIN_URL}?redirectTo=${encodeURIComponent(back)}`;
        return NextResponse.redirect(new URL(login, req.url));
      }
    }
    return decision;
  }

  // @neondatabase/auth 0.4.2-beta forwards the request's method to its
  // upstream get-session check, which only answers GET — so any POST (i.e.
  // every server action) would fail validation and 307 to the sign-in page.
  // Workaround: validate non-GET requests with a GET-equivalent request and
  // translate the middleware's decision back onto the original request.
  // (Server actions and API routes also self-enforce via requireUser().)
  const asGet = new NextRequest(
    new Request(req.url, { method: "GET", headers: req.headers }),
  );
  const decision = await neonMiddleware(asGet);
  const redirected = decision.status >= 300 && decision.status < 400;
  if (redirected) {
    return isApi
      ? unauthorizedJson()
      : NextResponse.redirect(new URL(LOGIN_URL, req.url));
  }
  return NextResponse.next();
}

export const config = {
  // Protect everything except: the auth handler and auth UI pages; the MCP
  // endpoint and the OAuth token/registration endpoints, which answer with
  // their own 401/400 JSON and must never be bounced to a sign-in page; the
  // privacy, terms and support pages, which signed-out visitors and
  // directory reviewers must be able to read; Next.js internals; and static
  // files (anything with a dot, which also covers /.well-known); and `/`
  // itself, the landing page, which redirects signed-in users on its own.
  // The trailing `.+` is what leaves `/` out: with `.*` the capture may be
  // empty and the root matches.
  // Each excluded segment is anchored with `(?:/|$)` so that a future
  // `/api/mcp-admin` or `/authz` is protected rather than silently skipped.
  matcher: [
    "/((?!(?:api/auth|api/mcp|auth|oauth/token|oauth/register|privacy|terms|support|_next)(?:/|$)|favicon\\.ico$|.*\\.).+)",
  ],
};

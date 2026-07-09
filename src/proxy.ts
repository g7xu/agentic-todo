import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";

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
const neonMiddleware = auth.middleware({ loginUrl: "/auth/sign-in" });

export default async function proxy(req: NextRequest) {
  // @neondatabase/auth 0.4.2-beta forwards the request's method to its
  // upstream get-session check, which only answers GET — so any POST (i.e.
  // every server action) would fail validation and 307 to the sign-in page.
  // Workaround: validate non-GET requests with a GET-equivalent request and
  // translate the middleware's decision back onto the original request.
  // (Server actions and API routes also self-enforce via requireUser().)
  if (req.method === "GET") return neonMiddleware(req);

  const asGet = new NextRequest(
    new Request(req.url, { method: "GET", headers: req.headers }),
  );
  const decision = await neonMiddleware(asGet);
  const redirected = decision.status >= 300 && decision.status < 400;
  if (redirected) return NextResponse.redirect(new URL("/auth/sign-in", req.url));
  return NextResponse.next();
}

export const config = {
  // Protect the index route plus everything except the auth handler, the auth
  // UI pages, Next.js internals, and static files (anything with a dot). `/` is
  // listed explicitly because the negative-lookahead pattern misses it.
  matcher: ["/", "/((?!api/auth|auth|_next|favicon.ico|.*\\.).*)"],
};

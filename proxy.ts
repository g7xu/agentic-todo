import { auth } from "@/lib/auth/server";

/**
 * Next.js 16 middleware (file is `proxy.ts` in v16; `middleware.ts` pre-16).
 * Redirects unauthenticated users on matched routes to the sign-in page and
 * refreshes the session cookie.
 */
export default auth.middleware({ loginUrl: "/auth/sign-in" });

export const config = {
  // Protect the index route plus everything except the auth handler, the auth
  // UI pages, Next.js internals, and static files (anything with a dot). `/` is
  // listed explicitly because the negative-lookahead pattern misses it.
  matcher: ["/", "/((?!api/auth|auth|_next|favicon.ico|.*\\.).*)"],
};

import { createNeonAuth } from "@neondatabase/auth/next/server";

/**
 * Neon Auth (Better Auth) server instance. Exposes Better Auth server methods
 * plus `.handler()` (API route), `.middleware()` (route protection), and
 * `.getSession()` (read the authenticated user on the server). Server-only.
 */
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET!,
    // "lax" (not the package's "strict" default) so the browser sends the
    // session cookies on the top-level redirect back from Google/Neon.
    // With "strict" the OAuth return lands with no cookies attached and the
    // user bounces to /auth/sign-in despite being signed in.
    sameSite: "lax",
  },
});

import { createNeonAuth } from "@neondatabase/auth/next/server";

/**
 * Neon Auth (Better Auth) server instance. Exposes Better Auth server methods
 * plus `.handler()` (API route), `.middleware()` (route protection), and
 * `.getSession()` (read the authenticated user on the server). Server-only.
 */
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET! },
});

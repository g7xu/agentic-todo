import { auth } from "@/lib/auth/server";

/**
 * Neon Auth catch-all handler. Proxies sign-in/out, OAuth callbacks, and
 * session endpoints to the hosted Neon Auth (Better Auth) instance.
 */
export const { GET, POST } = auth.handler();

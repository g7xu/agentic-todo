"use client";

import { NeonAuthUIProvider } from "@neondatabase/auth/react/ui";
import { authClient } from "@/lib/auth/client";

/**
 * Wraps the app in Neon Auth's UI context so AuthView / UserButton and the
 * client hooks work. Sign-in is Google OAuth and the email code only: both
 * prove the address is the signer's at that moment. Passwords are off
 * because Neon Auth does not verify email on password sign-up, which would
 * let anyone register someone else's address ahead of them.
 *
 * `redirectTo` must name a route the proxy matches: the OAuth return carries
 * a verifier that only the proxy exchanges for a session, and the proxy
 * skips `/`, so landing there leaves the user signed out. A `?redirectTo=`
 * on the sign-in URL still takes precedence.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <NeonAuthUIProvider
      authClient={authClient}
      credentials={false}
      emailOTP
      redirectTo="/upcoming"
      social={{ providers: ["google"] }}
    >
      {children}
    </NeonAuthUIProvider>
  );
}

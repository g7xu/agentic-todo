"use client";

import { NeonAuthUIProvider } from "@neondatabase/auth/react/ui";
import { authClient } from "@/lib/auth/client";

/**
 * Wraps the app in Neon Auth's UI context so AuthView / UserButton and the
 * client hooks work. Sign-in is Google OAuth and the email code only: both
 * prove the address is the signer's at that moment. Passwords are off
 * because Neon Auth does not verify email on password sign-up, which would
 * let anyone register someone else's address ahead of them.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <NeonAuthUIProvider
      authClient={authClient}
      credentials={false}
      emailOTP
      social={{ providers: ["google"] }}
    >
      {children}
    </NeonAuthUIProvider>
  );
}

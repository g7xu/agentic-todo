"use client";

import { NeonAuthUIProvider } from "@neondatabase/auth/react/ui";
import { authClient } from "@/lib/auth/client";

/**
 * Wraps the app in Neon Auth's UI context so AuthView / UserButton and the
 * client hooks work. Enables Google OAuth + email OTP (magic-code) sign-in,
 * matching the providers enabled in the Neon console (shared dev keys).
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <NeonAuthUIProvider
      authClient={authClient}
      emailOTP
      social={{ providers: ["google"] }}
    >
      {children}
    </NeonAuthUIProvider>
  );
}

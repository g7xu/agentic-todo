import Link from "next/link";
import { AuthView } from "@neondatabase/auth/react/ui";

/**
 * Catch-all Neon Auth UI route: /auth/sign-in, /auth/sign-up, /auth/callback,
 * /auth/magic-link, etc. The middleware's `loginUrl` points at /auth/sign-in.
 */
export default async function AuthPage({
  params,
}: {
  params: Promise<{ path: string }>;
}) {
  const { path } = await params;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 self-center p-4 md:p-6">
      <AuthView path={path} />
      <nav className="text-muted-foreground flex gap-4 text-xs">
        <Link href="/privacy" className="hover:text-foreground">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-foreground">
          Terms
        </Link>
        <Link href="/support" className="hover:text-foreground">
          Support
        </Link>
      </nav>
    </main>
  );
}

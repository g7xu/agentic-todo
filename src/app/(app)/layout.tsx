import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { prisma } from "@/lib/db";
import { ensureUserProvisioned } from "@/lib/provisioning";
import { TimezoneCapture } from "@/components/timezone-capture";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

/**
 * Authenticated app layout: guards access, provisions the user on first request
 * (Profile + Inbox), loads the timezone, and renders the shell (sidebar + main).
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");

  const user = session.user;
  await ensureUserProvisioned(user.id, user.email ?? "");

  const profile = await prisma.profile.findUnique({
    where: { id: user.id },
    select: { timezone: true, tzCaptured: true },
  });

  return (
    <AppShell timezone={profile?.timezone ?? "UTC"} userEmail={user.email ?? ""}>
      {children}
      {!profile?.tzCaptured && <TimezoneCapture />}
    </AppShell>
  );
}

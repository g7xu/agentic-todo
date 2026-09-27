"use client";

import { UserButton } from "@neondatabase/auth/react/ui";
import { Settings } from "lucide-react";
import { TimezoneProvider } from "@/components/timezone-context";
import { AppSidebar } from "@/components/app-sidebar";

export function AppShell({
  timezone,
  userEmail,
  children,
}: {
  timezone: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  return (
    <TimezoneProvider tz={timezone}>
      {/* h-dvh pins the shell to the viewport so `overflow-y-auto` on <main>
          is the real scroll container — body is min-h-full and would otherwise
          grow with content, letting pages run past the viewport bottom. */}
      <div className="flex h-dvh flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
          <span className="font-semibold tracking-tight">Agentic Todoist</span>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-sm">{userEmail}</span>
            {/* UserButton's built-in Settings item links to
                `${account.basePath}/${accountViewPaths.SETTINGS}` — i.e.
                /account/settings, a route this app never defined, so it 404'd.
                Drop the default link and point one at our own /settings. */}
            <UserButton
              size="icon"
              disableDefaultLinks
              additionalLinks={[
                {
                  href: "/settings",
                  icon: <Settings />,
                  label: "Settings",
                  signedIn: true,
                },
              ]}
            />
          </div>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </TimezoneProvider>
  );
}

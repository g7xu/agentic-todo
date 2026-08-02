"use client";

import { useState } from "react";
import { UserButton } from "@neondatabase/auth/react/ui";
import { MessageSquare, Settings } from "lucide-react";
import { TimezoneProvider } from "@/components/timezone-context";
import { AppSidebar } from "@/components/app-sidebar";
import { ChatPanel } from "@/components/chat/chat-panel";
import { cn } from "@/lib/utils";

export function AppShell({
  timezone,
  userEmail,
  children,
}: {
  timezone: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  const [chatOpen, setChatOpen] = useState(false);

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
            <button
              aria-label="Assistant"
              onClick={() => setChatOpen((o) => !o)}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors",
                chatOpen ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              <MessageSquare className="size-4" />
              Assistant
            </button>
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
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </TimezoneProvider>
  );
}

"use client";

import { useState } from "react";
import { UserButton } from "@neondatabase/auth/react/ui";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Menu, Settings } from "lucide-react";
import { TimezoneProvider } from "@/components/timezone-context";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { useRefetchOnNewDay } from "@/hooks/use-today";

/** Rendered inside `TimezoneProvider`, because the day it watches is the
 * profile timezone's, which the shell itself sits above. */
function DayRollover() {
  useRefetchOnNewDay();
  return null;
}

/**
 * The sidebar as a left drawer, for viewports below `md` where the fixed
 * sidebar is hidden. Following a link closes it, since the page behind is
 * what the user asked for.
 */
function NavDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="bg-background data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col shadow-lg duration-200 outline-none"
        >
          <DialogPrimitive.Title className="sr-only">
            Navigation
          </DialogPrimitive.Title>
          <AppSidebar
            className="h-full w-full overflow-y-auto"
            onNavigate={() => onOpenChange(false)}
          />
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}

export function AppShell({
  timezone,
  userEmail,
  children,
}: {
  timezone: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <TimezoneProvider tz={timezone}>
      <DayRollover />
      {/* h-dvh pins the shell to the viewport so `overflow-y-auto` on <main>
          is the real scroll container — body is min-h-full and would otherwise
          grow with content, letting pages run past the viewport bottom. */}
      <div className="flex h-dvh flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-3 md:px-4">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Open navigation"
              onClick={() => setNavOpen(true)}
            >
              <Menu />
            </Button>
            <span className="font-semibold tracking-tight">agenticTODO</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground hidden text-sm sm:inline">
              {userEmail}
            </span>
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
          <AppSidebar className="hidden md:flex" />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
      <NavDrawer open={navOpen} onOpenChange={setNavOpen} />
    </TimezoneProvider>
  );
}

"use client";

import { createContext, useContext } from "react";

const TimezoneContext = createContext<string>("UTC");

export function TimezoneProvider({
  tz,
  children,
}: {
  tz: string;
  children: React.ReactNode;
}) {
  return (
    <TimezoneContext.Provider value={tz}>{children}</TimezoneContext.Provider>
  );
}

/** The user's IANA timezone — the single source of truth for "today" (TDD §5). */
export function useTimezone(): string {
  return useContext(TimezoneContext);
}

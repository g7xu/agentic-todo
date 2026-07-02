/**
 * Date helpers. We treat task due dates as plain calendar dates ('YYYY-MM-DD'
 * strings) so all "today" comparisons are timezone-correct string compares
 * against `todayStr(tz)` (TDD §5). The DB column is a Postgres `date`, which
 * Prisma round-trips as a UTC-midnight `Date`.
 */

/** Today's local calendar date in the given IANA tz, as 'YYYY-MM-DD'. */
export function todayStr(tz: string): string {
  const zone = isValidTimeZone(tz) ? tz : "UTC";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** 'YYYY-MM-DD' → a UTC-midnight Date for storing into a Postgres `date`. */
export function toDbDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** A Postgres `date` Date (UTC midnight) → 'YYYY-MM-DD' string (or null). */
export function dbDateToStr(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Add `n` days to a 'YYYY-MM-DD' string, returning a 'YYYY-MM-DD' string. */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** List of IANA zones for the Settings dropdown (falls back to a small set). */
export function supportedTimeZones(): string[] {
  const f = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  if (typeof f.supportedValuesOf === "function") {
    try {
      return f.supportedValuesOf("timeZone");
    } catch {
      // fall through
    }
  }
  return ["UTC", "America/Chicago", "America/New_York", "America/Los_Angeles"];
}

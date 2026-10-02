/**
 * Date helpers. We treat task due dates as plain calendar dates ('YYYY-MM-DD'
 * strings) so all "today" comparisons are timezone-correct string compares
 * against `todayStr(tz)` (TDD §5). The DB column is a Postgres `date`, which
 * Prisma round-trips as a UTC-midnight `Date`.
 */

/** The local calendar date of `d` in the given IANA tz, as 'YYYY-MM-DD'. */
export function dateStrInTz(d: Date, tz: string): string {
  const zone = isValidTimeZone(tz) ? tz : "UTC";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Today's local calendar date in the given IANA tz, as 'YYYY-MM-DD'. */
export function todayStr(tz: string): string {
  return dateStrInTz(new Date(), tz);
}

/** Whole days from `a` to `b` ('YYYY-MM-DD' strings); negative if b < a. */
export function diffDays(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00.000Z`).getTime() -
      new Date(`${a}T00:00:00.000Z`).getTime()) /
      86_400_000,
  );
}

/** 'YYYY-MM-DD' → a UTC-midnight Date for storing into a Postgres `date`. */
export function toDbDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** A Postgres `date` Date (UTC midnight) → 'YYYY-MM-DD' string (or null). */
export function dbDateToStr(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/**
 * 'YYYY-MM-DD' → a Date at local midnight of that calendar day, for widgets
 * that read a Date through local getters. The runtime zone is only a carrier
 * here, so this is not interchangeable with `toDbDate` (UTC midnight).
 */
export function strToLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Inverse of `strToLocalDate`: the local calendar day of `d` as 'YYYY-MM-DD'. */
export function localDateToStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Add `n` days to a 'YYYY-MM-DD' string, returning a 'YYYY-MM-DD' string. */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Day of week of a 'YYYY-MM-DD' string: 0=Sunday … 6=Saturday. */
export function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
}

/** The Sunday starting the week that contains `dateStr`. */
export function startOfWeek(dateStr: string): string {
  return addDays(dateStr, -weekdayOf(dateStr));
}

/** Day of month (1-31) of a 'YYYY-MM-DD' string. */
export function dayOfMonth(dateStr: string): number {
  return Number(dateStr.slice(8, 10));
}

/** Whole months from `a` to `b` ('YYYY-MM-DD'), ignoring day of month. */
export function diffMonths(a: string, b: string): number {
  const years = Number(b.slice(0, 4)) - Number(a.slice(0, 4));
  return years * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
}

/** Number of days in the given month (`month` is 1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Add `n` months to a 'YYYY-MM-DD' string, clamping the day to the last day of
 * the target month when it would overflow (Jan 31 + 1 month → Feb 28/29), per
 * docs/ROUTINES.md §4.2. Never rolls into the following month. `n` may be
 * negative.
 */
export function addMonthsClamped(dateStr: string, n: number): string {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = dayOfMonth(dateStr);
  // Months-since-year-0 makes the arithmetic plain addition. Deriving the month
  // with `%` alone would go negative for negative `n` (JS keeps the sign), so
  // take it back out of the floored year instead.
  const total = year * 12 + (month - 1) + n;
  const targetYear = Math.floor(total / 12);
  const targetMonth = total - targetYear * 12 + 1;
  const clamped = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
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

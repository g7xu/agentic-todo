import { describe, expect, it } from "vitest";
import { dateStr } from "@/lib/validation/tasks";

describe("dateStr", () => {
  it("accepts real calendar days", () => {
    expect(dateStr.safeParse("2026-02-28").success).toBe(true);
    expect(dateStr.safeParse("2028-02-29").success).toBe(true);
    expect(dateStr.safeParse("2026-12-31").success).toBe(true);
  });

  it("rejects days that would roll over or do not exist", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "2026-04-31", "2027-02-29"]) {
      expect(dateStr.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("rejects the wrong shape before looking at the calendar", () => {
    for (const bad of ["tomorrow", "2026-1-1", "20260101", ""]) {
      expect(dateStr.safeParse(bad).success, bad).toBe(false);
    }
  });
});

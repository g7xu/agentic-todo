import { describe, expect, it } from "vitest";
import { isWeekStart, weekLabel } from "./reviews";

describe("isWeekStart", () => {
  it("accepts only the Sunday that starts a week", () => {
    expect(isWeekStart("2026-11-01")).toBe(true);
    expect(isWeekStart("2026-11-02")).toBe(false);
  });
});

describe("weekLabel", () => {
  it("names the month once when the week stays inside it", () => {
    expect(weekLabel("2026-10-25")).toBe("Oct 25 – 31");
  });
  it("names both months when the week crosses one", () => {
    expect(weekLabel("2026-11-29")).toBe("Nov 29 – Dec 5");
  });
});

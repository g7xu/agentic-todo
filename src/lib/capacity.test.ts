import { describe, expect, it } from "vitest";
import { availableOn, dayLoad } from "@/lib/capacity";

describe("availableOn", () => {
  const capacity = { defaultMinutes: 360, days: { "2026-11-01": 120, "2026-11-02": 0 } };

  it("prefers the day's override", () => {
    expect(availableOn("2026-11-01", capacity)).toBe(120);
  });

  it("treats a 0 override as a day off, not as unset", () => {
    expect(availableOn("2026-11-02", capacity)).toBe(0);
  });

  it("falls back to the default, and to null when there is none", () => {
    expect(availableOn("2026-11-03", capacity)).toBe(360);
    expect(availableOn("2026-11-03", { defaultMinutes: null, days: {} })).toBeNull();
  });
});

describe("dayLoad", () => {
  it("subtracts open estimates and completed work from the budget", () => {
    const load = dayLoad(
      360,
      [{ estimate: 60 }, { estimate: 90 }],
      [{ estimate: 30, timeUsed: 120 }],
    );
    expect(load).toEqual({
      available: 360,
      done: 120,
      planned: 150,
      unestimated: 0,
      free: 90,
    });
  });

  it("counts a completed task's estimate when no time was recorded", () => {
    expect(dayLoad(60, [], [{ estimate: 45, timeUsed: null }]).free).toBe(15);
  });

  it("counts items with no duration instead of guessing one", () => {
    const load = dayLoad(
      120,
      [{ estimate: null }, { estimate: 30 }],
      [{ estimate: null, timeUsed: null }],
    );
    expect(load.unestimated).toBe(2);
    expect(load.free).toBe(90);
  });

  it("goes negative when the day is over budget", () => {
    expect(dayLoad(60, [{ estimate: 90 }], []).free).toBe(-30);
  });

  it("has no free time to report without a budget", () => {
    const load = dayLoad(null, [{ estimate: 30 }], []);
    expect(load.free).toBeNull();
    expect(load.planned).toBe(30);
  });
});

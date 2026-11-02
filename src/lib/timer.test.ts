import { describe, expect, it } from "vitest";
import { formatElapsed, needsStopReview, sessionMinutes } from "@/lib/timer";

const at = (iso: string) => new Date(iso);

describe("sessionMinutes", () => {
  it("discards anything under a minute", () => {
    expect(sessionMinutes(at("2026-11-01T10:00:00Z"), at("2026-11-01T10:00:59Z"))).toBe(0);
  });

  it("rounds to the nearest minute", () => {
    expect(sessionMinutes(at("2026-11-01T10:00:00Z"), at("2026-11-01T10:01:00Z"))).toBe(1);
    expect(sessionMinutes(at("2026-11-01T10:00:00Z"), at("2026-11-01T10:12:29Z"))).toBe(12);
    expect(sessionMinutes(at("2026-11-01T10:00:00Z"), at("2026-11-01T10:12:30Z"))).toBe(13);
  });

  it("is 0 for an end before the start", () => {
    expect(sessionMinutes(at("2026-11-01T10:05:00Z"), at("2026-11-01T10:00:00Z"))).toBe(0);
  });
});

describe("formatElapsed", () => {
  it("shows m:ss under an hour and h:mm:ss from an hour", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(1122)).toBe("18:42");
    expect(formatElapsed(3600)).toBe("1:00:00");
    expect(formatElapsed(4925)).toBe("1:22:05");
  });

  it("floors fractions and clamps negatives", () => {
    expect(formatElapsed(61.9)).toBe("1:01");
    expect(formatElapsed(-5)).toBe("0:00");
  });
});

describe("needsStopReview", () => {
  const tz = "America/Los_Angeles";

  it("passes a short same-day session", () => {
    expect(
      needsStopReview(at("2026-11-01T17:00:00Z"), at("2026-11-01T19:59:00Z"), tz),
    ).toBe(false);
  });

  it("flags a session over 3 hours", () => {
    expect(
      needsStopReview(at("2026-11-01T17:00:00Z"), at("2026-11-01T20:01:00Z"), tz),
    ).toBe(true);
  });

  it("flags a short session across the user's local midnight", () => {
    // 11:30 PM to 12:30 AM Pacific, which is the same UTC day.
    expect(
      needsStopReview(at("2026-11-02T07:30:00Z"), at("2026-11-02T08:30:00Z"), tz),
    ).toBe(true);
  });

  it("ignores a UTC midnight that isn't the user's", () => {
    // 4:30 PM to 5:30 PM Pacific crosses UTC midnight only.
    expect(
      needsStopReview(at("2026-11-01T23:30:00Z"), at("2026-11-02T00:30:00Z"), tz),
    ).toBe(false);
  });
});

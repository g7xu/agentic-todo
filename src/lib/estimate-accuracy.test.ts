import { describe, expect, it } from "vitest";
import {
  dayOf,
  formatHours,
  isTimed,
  MIN_TASKS,
  onPlan,
  summarizeAccuracy,
  type CompletedRow,
} from "@/lib/estimate-accuracy";

const LA = "America/Los_Angeles";
const WEEK = ["2026-10-04", "2026-10-10"] as const;

let seq = 0;
function oneOff(
  projectId: string,
  completedAt: string,
  estimate: number | null,
  timeUsed: number | null,
  content = `task ${++seq}`,
): CompletedRow {
  return {
    id: `id-${String(++seq).padStart(4, "0")}`,
    content,
    projectId,
    routineId: null,
    estimate,
    timeUsed,
    dueDate: null,
    completedAt: new Date(completedAt),
  };
}

function routineDay(
  projectId: string,
  dueDate: string,
  completedAt: string,
  estimate: number,
  timeUsed: number,
): CompletedRow {
  return {
    id: `id-${String(++seq).padStart(4, "0")}`,
    content: "Job Application",
    projectId,
    routineId: "r1",
    estimate,
    timeUsed,
    dueDate: new Date(`${dueDate}T00:00:00.000Z`),
    completedAt: new Date(completedAt),
  };
}

const MID_WEEK = "2026-10-07T18:00:00Z";

describe("dayOf", () => {
  it("places an ordinary task on the user-local day it was completed", () => {
    // 06:30Z on the 11th is still the evening of the 10th in Los Angeles.
    const row = oneOff("p", "2026-10-11T06:30:00Z", 30, 30);
    expect(dayOf(row, LA)).toBe("2026-10-10");
    expect(dayOf(row, "UTC")).toBe("2026-10-11");
  });

  it("places a routine day on the day it was due, not the day it was made up", () => {
    const row = routineDay("p", "2026-10-05", "2026-10-09T20:00:00Z", 30, 60);
    expect(dayOf(row, LA)).toBe("2026-10-05");
  });
});

describe("isTimed", () => {
  it("needs a positive estimate and a positive time used", () => {
    expect(isTimed({ estimate: 30, timeUsed: 45 })).toBe(true);
    for (const [estimate, timeUsed] of [
      [null, 45],
      [30, null],
      [0, 45],
      [30, 0],
    ] as const) {
      expect(isTimed({ estimate, timeUsed }), `${estimate}/${timeUsed}`).toBe(
        false,
      );
    }
  });
});

describe("summarizeAccuracy", () => {
  it("compares only rows with both numbers, but counts every completion as done", () => {
    const rows = [
      oneOff("a", MID_WEEK, 60, 90),
      oneOff("a", MID_WEEK, 60, null),
      oneOff("a", MID_WEEK, null, 30),
      oneOff("a", MID_WEEK, 0, 30),
    ];
    const s = summarizeAccuracy(rows, ...WEEK, LA);
    expect(s).toMatchObject({ done: 4, timed: 1 });
    expect(s.projects[0]).toMatchObject({
      tasks: 1,
      estimatedMinutes: 60,
      usedMinutes: 90,
    });
  });

  it("counts only rows whose day falls inside the window", () => {
    const rows = [
      oneOff("a", "2026-10-11T06:30:00Z", 60, 60), // local 10-10: in
      oneOff("a", "2026-10-11T07:30:00Z", 60, 60), // local 10-11: out
      oneOff("a", "2026-10-04T06:59:00Z", 60, 60), // local 10-03: out
      oneOff("a", "2026-10-04T07:00:00Z", 60, 60), // local 10-04: in
    ];
    expect(summarizeAccuracy(rows, ...WEEK, LA)).toMatchObject({
      done: 2,
      timed: 2,
    });
  });

  it("windows a routine day by its due day even when it was ticked outside the window", () => {
    const rows = [
      routineDay("a", "2026-10-03", "2026-10-06T20:00:00Z", 30, 60),
      routineDay("a", "2026-10-10", "2026-10-12T20:00:00Z", 30, 90),
    ];
    const s = summarizeAccuracy(rows, ...WEEK, LA);
    expect(s.projects[0]).toMatchObject({ tasks: 1, usedMinutes: 90 });
  });

  it("names the task furthest from its estimate, over or under", () => {
    const rows = [
      oneOff("a", MID_WEEK, 240, 600, "lanceDB review"),
      oneOff("a", MID_WEEK, 240, 120, "System design prep"),
      routineDay("a", "2026-10-06", MID_WEEK, 30, 90),
    ];
    const miss = summarizeAccuracy(rows, ...WEEK, LA).projects[0].biggestMiss;
    expect(miss).toMatchObject({
      content: "lanceDB review",
      estimate: 240,
      timeUsed: 600,
      routine: false,
    });
  });

  it("marks a routine day as the biggest miss when it is one", () => {
    const rows = [
      oneOff("a", MID_WEEK, 30, 40),
      routineDay("a", "2026-10-06", MID_WEEK, 30, 90),
    ];
    const miss = summarizeAccuracy(rows, ...WEEK, LA).projects[0].biggestMiss;
    expect(miss).toMatchObject({ routine: true, timeUsed: 90 });
  });

  it("puts judged projects first, each group ordered by estimated minutes", () => {
    const many = (p: string, est: number) =>
      Array.from({ length: MIN_TASKS }, () => oneOff(p, MID_WEEK, est, est));
    const rows = [
      oneOff("thin-big", MID_WEEK, 900, 900),
      ...many("judged-small", 10),
      ...many("judged-large", 60),
      oneOff("thin-small", MID_WEEK, 15, 15),
    ];
    const order = summarizeAccuracy(rows, ...WEEK, LA).projects.map(
      (p) => p.projectId,
    );
    expect(order).toEqual([
      "judged-large",
      "judged-small",
      "thin-big",
      "thin-small",
    ]);
  });

  it("returns no projects for an empty window", () => {
    expect(summarizeAccuracy([], ...WEEK, LA)).toEqual({
      done: 0,
      timed: 0,
      projects: [],
    });
  });
});

describe("onPlan", () => {
  it("is true within 15% of the estimate either way", () => {
    expect(onPlan({ estimatedMinutes: 100, usedMinutes: 115 })).toBe(true);
    expect(onPlan({ estimatedMinutes: 100, usedMinutes: 85 })).toBe(true);
    expect(onPlan({ estimatedMinutes: 100, usedMinutes: 116 })).toBe(false);
    expect(onPlan({ estimatedMinutes: 100, usedMinutes: 84 })).toBe(false);
  });
});

describe("formatHours", () => {
  it("shows minutes under an hour and tenths of an hour above", () => {
    expect(formatHours(45)).toBe("45m");
    expect(formatHours(60)).toBe("1h");
    expect(formatHours(258)).toBe("4.3h");
    expect(formatHours(1473)).toBe("24.6h");
    expect(formatHours(1200)).toBe("20h");
  });
});

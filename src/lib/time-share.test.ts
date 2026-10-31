import { describe, expect, it } from "vitest";
import {
  dayOf,
  summarizeTimeByProject,
  type CompletedRow,
} from "@/lib/time-share";

const LA = "America/Los_Angeles";

function oneOff(
  projectId: string,
  completedAt: string,
  estimate: number | null = null,
  timeUsed: number | null = null,
): CompletedRow {
  return {
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
  estimate: number | null,
): CompletedRow {
  return {
    projectId,
    routineId: "r1",
    estimate,
    timeUsed: null,
    dueDate: new Date(`${dueDate}T00:00:00.000Z`),
    completedAt: new Date(completedAt),
  };
}

describe("dayOf", () => {
  it("places an ordinary task on the user-local day it was completed", () => {
    // 06:30Z on the 11th is still the evening of the 10th in Los Angeles.
    expect(dayOf(oneOff("p", "2026-10-11T06:30:00Z"), LA)).toBe("2026-10-10");
    expect(dayOf(oneOff("p", "2026-10-11T06:30:00Z"), "UTC")).toBe(
      "2026-10-11",
    );
  });

  it("places a routine day on the day it was due, not the day it was made up", () => {
    const row = routineDay("p", "2026-10-05", "2026-10-09T20:00:00Z", 30);
    expect(dayOf(row, LA)).toBe("2026-10-05");
  });

  it("has no day for an ordinary row with no completion time", () => {
    const row = { ...oneOff("p", "2026-10-10T00:00:00Z"), completedAt: null };
    expect(dayOf(row, LA)).toBeNull();
  });
});

describe("summarizeTimeByProject", () => {
  it("counts only rows whose day falls inside the window", () => {
    const rows = [
      oneOff("a", "2026-10-11T06:30:00Z", 60), // local 10-10: in
      oneOff("a", "2026-10-11T07:30:00Z", 60), // local 10-11: out
      oneOff("a", "2026-10-04T06:59:00Z", 60), // local 10-03: out
      oneOff("a", "2026-10-04T07:00:00Z", 60), // local 10-04: in
    ];
    const s = summarizeTimeByProject(rows, "2026-10-04", "2026-10-10", LA);
    expect(s.totals.tasks).toBe(2);
    expect(s.totals.estimatedMinutes).toBe(120);
  });

  it("keeps a project with finished work but no estimates", () => {
    const rows = [
      oneOff("networking", "2026-10-06T18:00:00Z"),
      oneOff("networking", "2026-10-07T18:00:00Z"),
      oneOff("jobs", "2026-10-07T18:00:00Z", 90),
    ];
    const s = summarizeTimeByProject(rows, "2026-10-04", "2026-10-10", LA);
    expect(s.projects.map((p) => p.projectId)).toEqual(["jobs", "networking"]);
    expect(s.projects[1]).toMatchObject({
      tasks: 2,
      estimatedMinutes: 0,
      unestimated: 2,
    });
  });

  it("treats an explicit zero estimate as estimated", () => {
    const s = summarizeTimeByProject(
      [oneOff("a", "2026-10-06T18:00:00Z", 0)],
      "2026-10-04",
      "2026-10-10",
      LA,
    );
    expect(s.projects[0]).toMatchObject({ unestimated: 0, estimatedMinutes: 0 });
  });

  it("sums timeUsed only where it was logged, separately from estimates", () => {
    const rows = [
      oneOff("a", "2026-10-06T18:00:00Z", 60, 90),
      oneOff("a", "2026-10-06T19:00:00Z", 60, null),
    ];
    const s = summarizeTimeByProject(rows, "2026-10-04", "2026-10-10", LA);
    expect(s.projects[0]).toMatchObject({
      estimatedMinutes: 120,
      timeUsedMinutes: 90,
      withTimeUsed: 1,
    });
  });

  it("splits routine days out of a project's count and minutes", () => {
    const rows = [
      routineDay("jobs", "2026-10-06", "2026-10-06T20:00:00Z", 30),
      routineDay("jobs", "2026-10-07", "2026-10-07T20:00:00Z", null),
      oneOff("jobs", "2026-10-07T18:00:00Z", 120),
    ];
    const s = summarizeTimeByProject(rows, "2026-10-04", "2026-10-10", LA);
    expect(s.projects[0]).toMatchObject({
      tasks: 3,
      estimatedMinutes: 150,
      unestimated: 1,
      routineTasks: 2,
      routineMinutes: 30,
    });
  });

  it("windows a routine day by its due day even when completed outside the window", () => {
    const rows = [
      routineDay("jobs", "2026-10-03", "2026-10-06T20:00:00Z", 30), // due before window
      routineDay("jobs", "2026-10-10", "2026-10-12T20:00:00Z", 30), // due inside, made up after
    ];
    const s = summarizeTimeByProject(rows, "2026-10-04", "2026-10-10", LA);
    expect(s.totals.tasks).toBe(1);
  });

  it("orders projects by estimated minutes, then by tasks done", () => {
    const rows = [
      oneOff("few-min", "2026-10-06T18:00:00Z", 10),
      oneOff("many-tasks", "2026-10-06T18:00:00Z"),
      oneOff("many-tasks", "2026-10-06T18:00:00Z"),
      oneOff("one-task", "2026-10-06T18:00:00Z"),
    ];
    const s = summarizeTimeByProject(rows, "2026-10-04", "2026-10-10", LA);
    expect(s.projects.map((p) => p.projectId)).toEqual([
      "few-min",
      "many-tasks",
      "one-task",
    ]);
  });

  it("returns empty totals for an empty window", () => {
    const s = summarizeTimeByProject([], "2026-10-04", "2026-10-10", LA);
    expect(s.projects).toEqual([]);
    expect(s.totals).toMatchObject({ tasks: 0, estimatedMinutes: 0 });
  });
});

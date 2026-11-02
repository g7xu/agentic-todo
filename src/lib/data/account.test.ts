import { describe, expect, it, vi } from "vitest";

/** Records the order of deletes inside `deleteAccount`'s transaction. */
const db = vi.hoisted(() => {
  const calls: string[] = [];
  const model = (name: string) => ({
    deleteMany: (args: unknown) => {
      calls.push(name);
      return args;
    },
  });
  const prisma = {
    oAuthGrant: model("oAuthGrant"),
    oAuthCode: model("oAuthCode"),
    reviewNote: model("reviewNote"),
    review: model("review"),
    timeEntry: model("timeEntry"),
    task: model("task"),
    routine: model("routine"),
    project: model("project"),
    dayCapacity: model("dayCapacity"),
    profile: model("profile"),
    $executeRaw: () => calls.push("neon_auth.user"),
    $transaction: async (ops: unknown[]) => ops,
  };
  return { calls, prisma };
});

vi.mock("@/lib/db", () => ({ prisma: db.prisma }));

import { deleteAccount } from "./account";

describe("deleteAccount", () => {
  it("deletes review notes and reviews before the tasks and profile they reference", async () => {
    await deleteAccount("user-a");
    const at = (name: string) => db.calls.indexOf(name);
    expect(at("reviewNote")).toBeGreaterThanOrEqual(0);
    expect(at("reviewNote")).toBeLessThan(at("review"));
    expect(at("review")).toBeLessThan(at("task"));
    expect(at("review")).toBeLessThan(at("profile"));
  });

  it("deletes time entries before the tasks and profile they reference", async () => {
    db.calls.length = 0;
    await deleteAccount("user-a");
    const at = (name: string) => db.calls.indexOf(name);
    expect(at("timeEntry")).toBeGreaterThanOrEqual(0);
    expect(at("timeEntry")).toBeLessThan(at("task"));
    expect(at("timeEntry")).toBeLessThan(at("profile"));
  });
});

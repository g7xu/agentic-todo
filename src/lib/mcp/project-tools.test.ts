import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";

const OWNER = "user-a";
const INBOX_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const FOREIGN_ID = "33333333-3333-4333-8333-333333333333";

/** One user's rows: the Inbox and one ordinary project. */
const db = vi.hoisted(() => {
  const calls: { op: string; args: unknown }[] = [];
  const record = (op: string, result: unknown) => (args: unknown) => {
    calls.push({ op, args });
    return result;
  };
  const prisma = {
    project: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      delete: record("project.delete", {}),
    },
    task: { updateMany: record("task.updateMany", { count: 1 }) },
    routine: { updateMany: record("routine.updateMany", { count: 1 }) },
    $transaction: async (ops: unknown[]) => ops,
  };
  return { calls, prisma };
});

vi.mock("@/lib/db", () => ({ prisma: db.prisma }));

import { registerTools } from "./tools";

type Result = { isError?: boolean; content: { text: string }[] };
type Handler = (args: unknown, ctx: ServerContext) => Promise<Result>;

function handlers(): Map<string, Handler> {
  const byName = new Map<string, Handler>();
  registerTools({
    registerTool: (name: string, _config: unknown, handler: Handler) =>
      byName.set(name, handler),
    registerPrompt: () => undefined,
  } as unknown as McpServer);
  return byName;
}

function call(name: string, args: unknown, scopes = ["tasks:read", "tasks:write"]) {
  const ctx = {
    http: { authInfo: { scopes, extra: { userId: OWNER } } },
  } as unknown as ServerContext;
  return handlers().get(name)!(args, ctx);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.calls.length = 0;
  db.prisma.project.updateMany.mockImplementation(
    async ({ where }: { where: { id: string; userId: string } }) => ({
      count: where.userId === OWNER && where.id !== FOREIGN_ID ? 1 : 0,
    }),
  );
  db.prisma.project.findFirst.mockImplementation(
    async ({ where }: { where: { id?: string; isInbox?: boolean } }) => {
      if (where.isInbox || where.id === INBOX_ID) {
        return { id: INBOX_ID, isInbox: true };
      }
      return where.id === PROJECT_ID ? { id: PROJECT_ID, isInbox: false } : null;
    },
  );
});

describe("update_project", () => {
  it("renames a project the caller owns", async () => {
    const result = await call("update_project", { id: PROJECT_ID, name: "Renamed" });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ id: PROJECT_ID, name: "Renamed" });
    expect(db.prisma.project.updateMany).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, userId: OWNER },
      data: { name: "Renamed" },
    });
  });

  it("reports an id the caller does not own", async () => {
    const result = await call("update_project", { id: FOREIGN_ID, name: "Renamed" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Project not found");
  });

  it("refuses a read-only connection", async () => {
    const result = await call(
      "update_project",
      { id: PROJECT_ID, name: "Renamed" },
      ["tasks:read"],
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("read-only");
    expect(db.prisma.project.updateMany).not.toHaveBeenCalled();
  });
});

describe("delete_project", () => {
  it("moves tasks and routines to the Inbox, then deletes", async () => {
    const result = await call("delete_project", { id: PROJECT_ID });
    expect(JSON.parse(result.content[0].text)).toEqual({ deleted: true, id: PROJECT_ID });
    const moved = { where: { projectId: PROJECT_ID, userId: OWNER }, data: { projectId: INBOX_ID } };
    expect(db.calls).toEqual([
      { op: "task.updateMany", args: moved },
      { op: "routine.updateMany", args: moved },
      { op: "project.delete", args: { where: { id: PROJECT_ID } } },
    ]);
  });

  it("refuses the Inbox", async () => {
    const result = await call("delete_project", { id: INBOX_ID });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("The Inbox project cannot be deleted");
    expect(db.calls).toEqual([]);
  });

  it("reports an id the caller does not own", async () => {
    const result = await call("delete_project", { id: FOREIGN_ID });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Project not found");
    expect(db.calls).toEqual([]);
  });

  it("refuses a read-only connection", async () => {
    const result = await call("delete_project", { id: PROJECT_ID }, ["tasks:read"]);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("read-only");
    expect(db.calls).toEqual([]);
  });
});

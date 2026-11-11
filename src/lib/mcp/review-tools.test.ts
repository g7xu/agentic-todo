import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InMemoryTransport,
  McpServer,
  type JSONRPCMessage,
} from "@modelcontextprotocol/server";

const OWNER = "user-a";
const NOTE = "44444444-4444-4444-8444-444444444444";

/**
 * update_review_note took over move_review_note: one call can change a note's
 * text, its column, or both. The data functions are stubbed so the test sees
 * exactly which ones the tool calls and in what order.
 */
const data = vi.hoisted(() => {
  const calls: string[] = [];
  const note = { id: "", kind: "unsorted", content: "Old text", order: 1, carriedTaskId: null };
  return {
    calls,
    note,
    updateNote: vi.fn(async (_u: string, id: string, content: string) => {
      calls.push("updateNote");
      Object.assign(note, { id, content });
      return { ...note };
    }),
    moveNote: vi.fn(async (_u: string, id: string, input: { kind: string }) => {
      calls.push("moveNote");
      Object.assign(note, { id, kind: input.kind });
      return { ...note };
    }),
  };
});

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/data/reviews", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/reviews")>()),
  updateNote: data.updateNote,
  moveNote: data.moveNote,
}));

import { registerTools } from "./tools";

/** Calls one tool through the MCP server, so input validation runs as it does live. */
async function callTool(name: string, args: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "0" });
  registerTools(server);
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  await server.connect(serverEnd);
  const authInfo = {
    token: "test",
    clientId: "test",
    scopes: ["tasks:read", "tasks:write"],
    extra: { userId: OWNER },
  };
  const pending = new Map<number, (m: JSONRPCMessage) => void>();
  clientEnd.onmessage = (m) => {
    if ("id" in m && typeof m.id === "number") pending.get(m.id)?.(m);
  };
  await clientEnd.start();
  const send = (id: number, method: string, params: unknown) =>
    new Promise<JSONRPCMessage>((resolve) => {
      pending.set(id, resolve);
      void clientEnd.send({ jsonrpc: "2.0", id, method, params } as JSONRPCMessage, { authInfo });
    });
  await send(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  });
  await clientEnd.send({ jsonrpc: "2.0", method: "notifications/initialized" } as JSONRPCMessage, {
    authInfo,
  });
  const res = (await send(2, "tools/call", { name, arguments: args })) as unknown as {
    result: { isError?: boolean; content: { text: string }[] };
  };
  await server.close();
  return res.result;
}

beforeEach(() => {
  vi.clearAllMocks();
  data.calls.length = 0;
  Object.assign(data.note, { kind: "unsorted", content: "Old text" });
});

describe("update_review_note", () => {
  it("replaces the text only", async () => {
    const res = await callTool("update_review_note", { id: NOTE, content: "New text" });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text)).toEqual({ id: NOTE, kind: "unsorted", content: "New text" });
    expect(data.calls).toEqual(["updateNote"]);
  });

  it("moves the note only, to the end of the new column", async () => {
    const res = await callTool("update_review_note", { id: NOTE, kind: "rose" });
    expect(JSON.parse(res.content[0].text)).toEqual({ id: NOTE, kind: "rose", content: "Old text" });
    expect(data.calls).toEqual(["moveNote"]);
    expect(data.moveNote).toHaveBeenCalledWith(OWNER, NOTE, { kind: "rose" });
  });

  it("does both in one call", async () => {
    const res = await callTool("update_review_note", { id: NOTE, content: "New text", kind: "action" });
    expect(JSON.parse(res.content[0].text)).toEqual({ id: NOTE, kind: "action", content: "New text" });
    expect(data.calls).toEqual(["updateNote", "moveNote"]);
  });

  it("refuses a call that changes nothing", async () => {
    const res = await callTool("update_review_note", { id: NOTE });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/content, kind, or both/);
    expect(data.calls).toEqual([]);
  });

  it("stops at a refused text edit without moving the note", async () => {
    data.updateNote.mockRejectedValueOnce(new Error("Note not found"));
    const res = await callTool("update_review_note", { id: NOTE, content: "New text", kind: "seed" });
    expect(res).toMatchObject({ isError: true, content: [{ text: "Note not found" }] });
    expect(data.calls).toEqual([]);
  });
});

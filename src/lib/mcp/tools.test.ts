import { describe, expect, it, vi } from "vitest";
import {
  InMemoryTransport,
  McpServer,
  type JSONRPCMessage,
} from "@modelcontextprotocol/server";

// The tool bodies never run here; only the registered metadata is read.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { INSTRUCTIONS, registerTools } from "./tools";

type ListedTool = {
  name: string;
  title?: string;
  description?: string;
  annotations?: Record<string, unknown>;
};

/** What a client sees: the server's initialize result and its tool list. */
async function listTools() {
  const server = new McpServer(
    { name: "test", version: "0" },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server);
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  await server.connect(serverEnd);

  const pending = new Map<number, (m: JSONRPCMessage) => void>();
  clientEnd.onmessage = (m) => {
    if ("id" in m && typeof m.id === "number") pending.get(m.id)?.(m);
  };
  await clientEnd.start();
  const call = (id: number, method: string, params: unknown) =>
    new Promise<JSONRPCMessage>((resolve) => {
      pending.set(id, resolve);
      void clientEnd.send({ jsonrpc: "2.0", id, method, params } as JSONRPCMessage);
    });

  const init = (await call(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  })) as unknown as { result: { instructions?: string } };
  await clientEnd.send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  } as JSONRPCMessage);
  const list = (await call(2, "tools/list", {})) as unknown as {
    result: { tools: ListedTool[] };
  };
  await server.close();
  return { instructions: init.result.instructions, tools: list.result.tools };
}

const READ_TOOLS = ["list_tasks", "list_projects", "list_routines", "get_routine_history"];
const DESTRUCTIVE_TOOLS = ["delete_task", "bulk_delete"];

/** Phrases that read as instructions to the model rather than facts about
 * the data. The connector directory rejects descriptions that steer the
 * model. */
const DIRECTIVE = /\b(you should|you must|always|never|do not|don't|propose|ask the user|confirm with)\b/i;

describe("MCP tool surface", () => {
  it("names every tool for a directory listing", async () => {
    const { tools } = await listTools();
    expect(tools).toHaveLength(13);
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(t.name.length).toBeLessThanOrEqual(64);
      expect(t.title, t.name).toBeTruthy();
      expect(t.description, t.name).toBeTruthy();
    }
  });

  it("annotates every tool with readOnlyHint and destructiveHint", async () => {
    const { tools } = await listTools();
    for (const t of tools) {
      const a = t.annotations ?? {};
      expect(typeof a.readOnlyHint, t.name).toBe("boolean");
      expect(typeof a.destructiveHint, t.name).toBe("boolean");
      expect(a.openWorldHint, t.name).toBe(false);
      if (READ_TOOLS.includes(t.name)) {
        expect(a.readOnlyHint, t.name).toBe(true);
        expect(a.destructiveHint, t.name).toBe(false);
      } else {
        expect(a.readOnlyHint, t.name).toBe(false);
        expect(a.destructiveHint, t.name).toBe(DESTRUCTIVE_TOOLS.includes(t.name));
      }
    }
  });

  it("describes data, not model behaviour", async () => {
    const { instructions, tools } = await listTools();
    expect(instructions).toBe(INSTRUCTIONS);
    expect(instructions).not.toMatch(DIRECTIVE);
    for (const t of tools) {
      expect(t.description, t.name).not.toMatch(DIRECTIVE);
    }
  });
});

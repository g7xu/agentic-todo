import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { INSTRUCTIONS, registerTools } from "@/lib/mcp/tools";
import { issuer } from "@/lib/oauth/config";
import { verifyAccessToken } from "@/lib/oauth/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The MCP endpoint (docs/MCP.md §3): stateless Streamable HTTP, every request
 * bearer-authenticated. Built on first request rather than at module load so
 * that the issuer is read at runtime, where APP_URL is guaranteed to exist.
 */
let handler: ((req: Request) => Promise<Response>) | undefined;

function getHandler() {
  handler ??= withMcpAuth(
    createMcpHandler(registerTools, {
      instructions: INSTRUCTIONS,
      serverInfo: { name: "agentic-todoist", version: "1.0.0" },
    }),
    verifyAccessToken,
    {
      required: true,
      resourceMetadataPath: "/.well-known/oauth-protected-resource",
      resourceUrl: issuer(),
    },
  );
  return handler;
}

export function GET(req: Request) {
  return getHandler()(req);
}

export function POST(req: Request) {
  return getHandler()(req);
}

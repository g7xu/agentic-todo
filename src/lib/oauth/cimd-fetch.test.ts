import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchDocument } from "@/lib/oauth/cimd";

/**
 * Pins the two network behaviours the SSRF defence depends on: a redirect is
 * never followed, and a body larger than the cap is abandoned mid-stream.
 * Runs against a throwaway local server; the https/public-host gates are
 * tested separately and are not exercised here.
 */
let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: `${base}/ok` });
      res.end();
    } else if (req.url === "/huge") {
      res.writeHead(200, { "content-type": "application/json" });
      const chunk = "x".repeat(16 * 1024);
      let sent = 0;
      const push = () => {
        while (sent < 10 * 1024 * 1024 && res.write(chunk)) sent += chunk.length;
        if (sent < 10 * 1024 * 1024) res.once("drain", push);
        else res.end();
      };
      push();
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ client_id: `${base}/ok`, redirect_uris: ["https://x/cb"] }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("fetchDocument", () => {
  it("returns a small JSON document", async () => {
    await expect(fetchDocument(`${base}/ok`)).resolves.toMatchObject({ client_id: `${base}/ok` });
  });

  it("refuses to follow a redirect", async () => {
    await expect(fetchDocument(`${base}/redirect`)).rejects.toThrow();
  });

  it("abandons a body larger than the cap", async () => {
    await expect(fetchDocument(`${base}/huge`)).rejects.toThrow(/too large/);
  });
});

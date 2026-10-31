import { createServer as createHttpServer, type Server } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";

const MAX_DEBUG_PAYLOAD_BYTES = 256 * 1024;

let viteServer: ViteDevServer;
let httpServer: Server;
let baseUrl = "";

async function startServer() {
  viteServer = await createServer({
    configFile: resolve(import.meta.dirname, "../vite.config.ts"),
    server: { middlewareMode: true, hmr: false },
    logLevel: "silent",
  });
  httpServer = createHttpServer(viteServer.middlewares);
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("HTTP test server did not bind to a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function stopServer() {
  await viteServer.close();
  if (httpServer.listening) {
    httpServer.close();
    await once(httpServer, "close");
  }
}

describe("debug collector HTTP guard", () => {
  beforeEach(startServer);
  afterEach(stopServer);

  it("accepts a same-origin local payload", async () => {
    const response = await fetch(`${baseUrl}/__manus__/logs`, {
      method: "POST",
      headers: {
        origin: baseUrl,
        "content-type": "application/json",
      },
      body: JSON.stringify({ consoleLogs: [] }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  it("rejects cross-origin payloads with 403", async () => {
    const response = await fetch(`${baseUrl}/__manus__/logs`, {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ consoleLogs: [] }),
    });

    expect(response.status).toBe(403);
  });

  it("rejects declared payloads above 256 KiB with 413", async () => {
    const response = await fetch(`${baseUrl}/__manus__/logs`, {
      method: "POST",
      headers: {
        origin: baseUrl,
        "content-type": "application/json",
        "content-length": String(MAX_DEBUG_PAYLOAD_BYTES + 1),
      },
      body: "x".repeat(MAX_DEBUG_PAYLOAD_BYTES + 1),
    });

    expect(response.status).toBe(413);
  });
});

import { it, expect } from "vitest";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import type { Socket } from "node:net";
it("load runner rejects malformed server frames with a machine-readable failure", async () => {
  const sockets = new Set<Socket>();
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ testMode: true }));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") throw error;
    });
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (request, socket) => {
    const accept = createHash("sha1")
      .update(String(request.headers["sec-websocket-key"]) + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.write(Buffer.from([0x81, 3, 98, 97, 100]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test listener");
    const result = await new Promise<{ code: unknown; stdout: string; stderr: string }>((resolve) =>
      execFile(
        process.execPath,
        ["scripts/load-multiplayer.mjs"],
        { env: { ...process.env, MULTIPLAYER_LOAD_URL: `ws://127.0.0.1:${address.port}` }, timeout: 10000 },
        (error, stdout, stderr) => resolve({ code: error?.code, stdout, stderr }),
      ),
    );
    expect(result.code).toBe(1);
    const report = JSON.parse(result.stderr.trim().split("\n").at(-1)!);
    expect(report).toMatchObject({ ok: false, error: expect.stringContaining("invalid JSON from server") });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 15000);

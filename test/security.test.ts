import { describe, expect, it, vi } from "vitest";
import { mintTicket, verifyTicket, checkTurnstile, localSecurityBypass } from "../server/security";
import { testGate } from "../server/testGate";
const secret = "private-test-secret-not-a-real-credential";
const identity = { clientId: "client-12345", room: "ABC123", role: "host" as const };
describe("room admission security", () => {
  it("keeps matchmaking admission separate from every room ticket", async () => {
    const who = { clientId: "client-12345", room: "ONLINE", role: "player" as const };
    const queue = await mintTicket(secret, who, 1000, "queue-admission-v1");
    const room = await mintTicket(secret, who, 1000);
    expect(await verifyTicket(secret, queue, "ONLINE", 2000)).toBeNull();
    expect(await verifyTicket(secret, room, "ONLINE", 2000, "queue-admission-v1")).toBeNull();
    expect(await verifyTicket(secret, queue, "ABC123", 2000, "queue-admission-v1")).toBeNull();
    expect(await verifyTicket(secret, queue, "ONLINE", 2000, "queue-admission-v1")).toMatchObject(who);
  });
  it("binds signed tickets to room, expiry and untouched payload", async () => {
    const t = await mintTicket(secret, identity, 1000);
    expect(await verifyTicket(secret, t, "ABC123", 2000)).toMatchObject(identity);
    expect(await verifyTicket(secret, t, "OTHER1", 2000)).toBeNull();
    expect(await verifyTicket(secret, t, "ABC123", 1000 + 24 * 3600_000)).toBeNull();
    expect(await verifyTicket(secret, t.slice(0, -4) + "aaaa", "ABC123", 2000)).toBeNull();
    expect(await verifyTicket("other-key", t, "ABC123", 2000)).toBeNull();
  });
  it("requires success, exact production hostname and action from Siteverify", async () => {
    const verify = vi.fn();
    const test = () => checkTurnstile(secret, "token", "127.0.0.1", "technique.ink", verify);
    for (const data of [
      { success: false },
      { success: true, hostname: "localhost", action: "room_access" },
      { success: true, hostname: "technique.ink", action: "login" },
    ]) {
      verify.mockResolvedValueOnce(Response.json(data));
      expect(await test()).toBe(false);
    }
    verify.mockResolvedValueOnce(
      Response.json({ success: true, hostname: "technique.ink", action: "room_access" }),
    );
    expect(await test()).toBe(true);
    verify.mockRejectedValueOnce(new Error("network"));
    expect(await test()).toBe(false);
  });
  it("never grants remote testing bypass from a query parameter or TEST_MODE alone", () => {
    expect(
      localSecurityBypass(new Request("https://technique.ink/?test=1"), {
        TEST_MODE: "true",
        APP_ORIGIN: "http://localhost:18768",
      }),
    ).toBe(false);
    expect(
      localSecurityBypass(new Request("http://localhost:1999"), { APP_ORIGIN: "http://localhost:18768" }),
    ).toBe(true);
  });
  it("private test server rejects missing secret, wrong key and unauthenticated access", async () => {
    expect((await testGate(new Request("https://test.workers.dev/simulate"), undefined))?.status).toBe(503);
    expect((await testGate(new Request("https://test.workers.dev/simulate"), secret))?.status).toBe(401);
    const r = await testGate(
      new Request("https://test.workers.dev/__test/login", { method: "POST", body: "access=wrong" }),
      secret,
    );
    expect(r?.status).toBe(403);
  });
  it("issues a secure private cookie and isolates it from production admission", async () => {
    const r = await testGate(
      new Request("https://test.workers.dev/__test/login", {
        method: "POST",
        body: new URLSearchParams({ access: secret }),
      }),
      secret,
    );
    expect(r?.status).toBe(303);
    const cookie = r!.headers.get("Set-Cookie")!;
    expect(cookie).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(
      await testGate(
        new Request("https://test.workers.dev/simulate", { headers: { Cookie: cookie.split(";")[0]! } }),
        secret,
      ),
    ).toBeNull();
    expect(await verifyTicket(secret, cookie.split(";")[0]!.split("=")[1]!, "ABC123")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { resolveMultiplayerEndpoint } from "../src/multiplayer/env";

describe("multiplayer networking", () => {
  it("uses the page origin so phones use the same public port as the game", () => {
    expect(resolveMultiplayerEndpoint({ origin: "http://192.168.1.50:18768", development: true })).toEqual({
      host: "192.168.1.50:18768",
      protocol: "ws",
    });
    expect(resolveMultiplayerEndpoint({ origin: "http://localhost:18768", development: true })).toEqual({
      host: "localhost:18768",
      protocol: "ws",
    });
  });
  it("ignores a stale localhost backend setting when opened on a phone", () => {
    expect(
      resolveMultiplayerEndpoint({
        origin: "http://192.168.1.50:18768",
        configured: "http://localhost:1999",
        development: true,
      }),
    ).toEqual({ host: "192.168.1.50:18768", protocol: "ws" });
  });
  it("keeps explicit production endpoints and uses encrypted sockets on HTTPS", () => {
    expect(
      resolveMultiplayerEndpoint({
        origin: "https://technique.ink",
        configured: "https://quiz.workers.dev",
        development: false,
      }),
    ).toEqual({ host: "quiz.workers.dev", protocol: "wss" });
    expect(resolveMultiplayerEndpoint({ origin: "https://technique.ink", development: false })).toEqual({
      host: "technique.ink",
      protocol: "wss",
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { simulationClient, simulationStorageKey } from "../src/dev/simulationContext";
import { getOrCreateClientId, getOrCreateHostToken, getSavedPlayerName } from "../src/multiplayer/identity";

afterEach(() => vi.unstubAllGlobals());

describe("public simulation identities", () => {
  it("isolates player identities, host credentials and admission tickets without replacing ordinary storage", () => {
    const values = new Map<string, string>();
    const location = { search: "" };
    vi.stubGlobal("window", {
      location,
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    const normalId = getOrCreateClientId();
    const normalHost = getOrCreateHostToken("ABC234");
    const ticketKey = "technique_admission:player:ABC234";
    expect(simulationStorageKey(ticketKey)).toBe(ticketKey);
    location.search = "?simClient=ABC234-0&simName=Аня";
    const firstId = getOrCreateClientId();
    const firstHost = getOrCreateHostToken("ABC234");
    const firstTicketKey = simulationStorageKey(ticketKey);
    expect(getSavedPlayerName()).toBe("Аня");
    expect(firstId).not.toBe(normalId);
    expect(firstHost).not.toBe(normalHost);
    location.search = "?simClient=ABC234-1";
    expect(getOrCreateClientId()).not.toBe(firstId);
    expect(simulationStorageKey(ticketKey)).not.toBe(firstTicketKey);
    location.search = "?simClient=ABC234-0";
    expect(getOrCreateClientId()).toBe(firstId);
    expect(getOrCreateHostToken("ABC234")).toBe(firstHost);
    location.search = "";
    expect(getOrCreateClientId()).toBe(normalId);
    expect(getOrCreateHostToken("ABC234")).toBe(normalHost);
  });

  it("ignores malformed or unbounded simulation namespaces", () => {
    for (const client of ["", "../host", "x".repeat(65)]) {
      vi.stubGlobal("window", { location: { search: `?simClient=${encodeURIComponent(client)}` } });
      expect(simulationClient()).toBeNull();
      expect(simulationStorageKey("ticket")).toBe("ticket");
    }
  });
});

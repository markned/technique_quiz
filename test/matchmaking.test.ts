import { describe, expect, it } from "vitest";
import { findOnlineMatch, type MatchmakingState, type SearchIdentity } from "../server/matchmaking";

function queue() {
  let state: MatchmakingState | undefined;
  let serial = 0;
  const rooms = new Map<string, { open: boolean; members: Set<string> }>();
  const runtime = {
    load: async () => structuredClone(state),
    save: async (next: MatchmakingState) => {
      state = structuredClone(next);
    },
    reserve: async (code: string, who: SearchIdentity) => {
      let room = rooms.get(code);
      if (!room) {
        room = { open: true, members: new Set() };
        rooms.set(code, room);
      }
      const accepted = room.members.has(who.clientId) || (room.open && room.members.size < 6);
      if (accepted) room.members.add(who.clientId);
      return { accepted, open: room.open };
    },
    release: async (code: string, who: SearchIdentity) => {
      rooms.get(code)?.members.delete(who.clientId);
    },
    code: () => `RM${String(++serial).padStart(4, "0")}`,
  };
  const identity = (n: number) => ({ clientId: `client-${n}`, playerToken: `secret-player-token-${n}` });
  return {
    runtime,
    rooms,
    identity,
    get state() {
      return state!;
    },
    set state(value) {
      state = value;
    },
  };
}

describe("bounded online matchmaking", () => {
  it("assigns at most six, reuses full lobbies after slots free and does not assign running matches", async () => {
    const q = queue();
    const first = await findOnlineMatch(q.runtime, q.identity(0));
    for (let n = 1; n < 6; n++) expect(await findOnlineMatch(q.runtime, q.identity(n))).toBe(first);
    const second = await findOnlineMatch(q.runtime, q.identity(6));
    expect(second).not.toBe(first);
    q.rooms.get(first)!.members.delete("client-0");
    expect(await findOnlineMatch(q.runtime, q.identity(7))).toBe(first);
    q.rooms.get(first)!.open = false;
    expect(await findOnlineMatch(q.runtime, q.identity(8))).toBe(second);
  });
  it("binds recovery to the reserved token and releases the old seat on explicit new search", async () => {
    const q = queue();
    const first = await findOnlineMatch(q.runtime, q.identity(0), 100000);
    expect(await findOnlineMatch(q.runtime, q.identity(0), 101000)).toBe(first);
    await expect(
      findOnlineMatch(q.runtime, { ...q.identity(0), playerToken: "other-secret-player-token" }, 102000),
    ).rejects.toThrow("identity_conflict");
    await expect(findOnlineMatch(q.runtime, { ...q.identity(0), fresh: true }, 102000)).rejects.toThrow(
      "search_cooldown",
    );
    q.rooms.get(first)!.open = false;
    const second = await findOnlineMatch(q.runtime, { ...q.identity(0), fresh: true }, 106000);
    expect(second).not.toBe(first);
    expect(q.rooms.get(first)!.members.has("client-0")).toBe(false);
  });
  it("caps daily room creation and prunes expired registry entries", async () => {
    const q = queue();
    await findOnlineMatch(q.runtime, q.identity(0), 100000);
    const state = q.state;
    state.createdToday = 200;
    state.assignments["expired"] = {
      code: "EXPIRE",
      token: "secret-player-token-expired",
      expiresAt: 100001,
      assignedAt: 1,
    };
    q.state = state;
    q.rooms.get(state.openRooms[0]!)!.open = false;
    await expect(findOnlineMatch(q.runtime, q.identity(2), 106000)).rejects.toThrow("daily_queue_limit");
    // On the next UTC day the creation budget resets.
    const code = await findOnlineMatch(q.runtime, q.identity(2), 86400000 + 106000);
    expect(code).toMatch(/^RM/);
    expect(q.state.createdToday).toBe(1);
    expect(q.state.assignments.expired).toBeUndefined();
  });
});

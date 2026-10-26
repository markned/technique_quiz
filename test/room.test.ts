import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as multiplayerRounds from "../src/multiplayer/rounds";
import { QuizRoom, type RoomConnection, type RoomRuntime, type StoredRoomState } from "../server/room";
import type { ConnectionMeta, ServerMessage } from "../src/multiplayer/types";

class Socket implements RoomConnection {
  state: ConnectionMeta | null = null;
  messages: ServerMessage[] = [];
  constructor(public id: string) {}
  setState(state: ConnectionMeta | null) {
    this.state = state;
  }
  send(raw: string) {
    this.messages.push(JSON.parse(raw));
  }
  get last() {
    return this.messages.at(-1)!;
  }
}

async function fixture(
  testMode = true,
  publishedRounds?: RoomRuntime["publishedRounds"],
  playerCount = 3,
  online = false,
) {
  let stored: StoredRoomState | undefined;
  let alarmAt = 0;
  const sockets: Socket[] = [];
  const runtime: RoomRuntime = {
    id: "E2ETST",
    testMode,
    publishedRounds,
    load: async () => structuredClone(stored),
    save: async (state, alarm) => {
      stored = structuredClone(state);
      alarmAt = alarm;
    },
    connections: () => sockets,
  };
  let game = new QuizRoom(runtime);
  await game.onStart();
  const connect = (id: string) => {
    const socket = new Socket(id);
    sockets.push(socket);
    game.onConnect(socket);
    return socket;
  };
  const send = (socket: Socket, message: unknown) => game.onMessage(JSON.stringify(message), socket);
  const host = connect("host");
  const hello = (socket = host) =>
    send(socket, { type: "host_hello", clientId: "host-client", hostToken: "host-secret-token" });
  if (!online) await hello();
  const players: Socket[] = [];
  const join = (socket: Socket, clientId: string, token = `secret-token-${clientId}`) =>
    send(socket, {
      type: "player_join",
      clientId,
      name: clientId,
      playerToken: token,
    });
  for (let n = 0; n < playerCount; n++) {
    const socket = connect(`socket-${n}`);
    if (online) await game.reserveOnline(`client-${n}`, `secret-token-client-${n}`);
    await join(socket, `client-${n}`);
    players.push(socket);
  }
  const due = async () => {
    const target = game.state.transitionUntil ?? game.state.deadlineAt ?? game.state.nextAdvanceAt ?? alarmAt;
    // A healthy display renews its lease while we advance the game clock.
    while (game.state.hostConnected && target - (game.state.hostLastSeenAt ?? Date.now()) >= 30_000) {
      vi.setSystemTime(Math.max(Date.now(), (game.state.hostLastSeenAt ?? Date.now()) + 29_000));
      await send(host, { type: "ping" });
    }
    if (online) {
      while (
        Object.values(game.state.playersById).some((p) => p.connected && target - p.lastSeenAt >= 30000)
      ) {
        const oldest = Math.min(
          ...Object.values(game.state.playersById)
            .filter((p) => p.connected)
            .map((p) => p.lastSeenAt),
        );
        vi.setSystemTime(Math.max(Date.now(), oldest + 29000));
        for (const player of players)
          if (player.state?.role === "player" && game.state.playersById[player.state.playerId]?.connected)
            await send(player, { type: "ping" });
      }
    }
    vi.setSystemTime(target);
    await game.onAlarm();
  };

  const chooseMode = async (mode = "quiz") => {
    await send(host, { type: "host_start_mode_select" });
    if (game.state.phase === "mode_select") {
      for (const player of players) await send(player, { type: "player_mode_vote", mode });
      await due();
    }
    expect(game.state.phase).toBe("rules");
  };
  const start = async (mode = "quiz") => {
    await chooseMode(mode);
    await send(host, { type: "host_start_game" });
    await due();
    expect(game.state.phase).toBe("playing");
    await send(host, { type: "host_media_ready", turnId: game.state.turnId });
    await due();
  };
  const close = async (socket: Socket) => {
    sockets.splice(sockets.indexOf(socket), 1);
    await game.onClose(socket);
  };
  return {
    get game() {
      return game;
    },
    host,
    hello,
    players,
    send,
    join,
    connect,
    due,
    start,
    chooseMode,
    close,
    get alarmAt() {
      return alarmAt;
    },
    restart: async () => {
      game = new QuizRoom(runtime);
      await game.onStart();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("authoritative room recovery", () => {
  it("runs a complete quiz with server alarms and scores each round once", async () => {
    const f = await fixture();
    await f.start();
    for (let round = 0; round < 3; round++) {
      const turnId = f.game.state.turnId;
      const answer = { variant: "mc4", selectedIndex: f.game.state.quiz!.correctIndex };
      if (f.game.state.quiz!.variant === "mc4") {
        for (const p of f.players) await f.send(p, { type: "player_quiz_answer", turnId, answer });
      } else await f.due();
      expect(f.game.state.phase).toBe("round_results");
      const scores = Object.values(f.game.state.playersById).map((p) => p.score);
      await f.game.onAlarm();
      expect(Object.values(f.game.state.playersById).map((p) => p.score)).toEqual(scores);
      await f.due();
      if (round < 2) {
        await f.due();
        await f.send(f.host, { type: "host_media_ready", turnId: f.game.state.turnId });
        await f.due();
      }
    }
    expect(f.game.state.phase).toBe("finished");
  });

  it("restores state and the deadline after a server restart", async () => {
    const f = await fixture();
    await f.start();
    const deadline = f.game.state.deadlineAt;
    await f.restart();
    expect(f.game.state.phase).toBe("quiz_answering");
    expect(f.alarmAt).toBe(deadline);
    await f.due();
    expect(f.game.state.phase).toBe("round_results");
  });

  it("pauses when the screen leaves, freezes time, and resumes on another device", async () => {
    const f = await fixture();
    await f.start();
    const remaining = f.game.state.deadlineAt! - Date.now();
    await f.close(f.host);
    expect(f.game.state.pausedAt).toBe(Date.now());
    vi.setSystemTime(Date.now() + 60_000);
    await f.game.onAlarm();
    expect(f.game.state.phase).toBe("quiz_answering");
    const next = f.connect("replacement-host");
    await f.hello(next);
    expect(f.game.state.pausedAt).toBeNull();
    expect(f.game.state.deadlineAt! - Date.now()).toBe(remaining);
  });

  it("expires after 30 minutes and rejects even a remembered host", async () => {
    const f = await fixture();
    await f.start();
    await f.close(f.host);
    vi.setSystemTime(Date.now() + 30 * 60_000);
    await f.game.onAlarm();
    expect(f.game.state.phase).toBe("expired");
    const next = f.connect("expired-host");
    await f.hello(next);
    expect(next.last).toMatchObject({ type: "error", code: "room_expired" });
  });

  it("rejoins a player on a new socket and ignores close of the old socket", async () => {
    const f = await fixture();
    await f.start();
    const original = f.players[0]!;
    const playerId = original.state!.role === "player" ? original.state.playerId : "";
    const next = f.connect("reconnected-player");
    await f.join(next, "client-0");
    await f.close(original);
    expect(f.game.state.playersById[playerId]!.connected).toBe(true);
    expect(Object.keys(f.game.state.playersById)).toHaveLength(3);
    expect(next.messages.some((m) => m.type === "snapshot" && m.you.reconnected)).toBe(true);
  });

  it("does not let a public player ID or client ID steal a seat", async () => {
    const f = await fixture();
    await f.start();
    const victim = f.players[0]!.state!;
    const attacker = f.connect("attacker");
    await f.send(attacker, {
      type: "player_join",
      clientId: "client-0",
      name: "attacker",
      knownPlayerId: victim.role === "player" ? victim.playerId : "",
      playerToken: "attacker-token-value",
    });
    expect(attacker.last).toMatchObject({ type: "error", code: "bad_phase" });
    expect(Object.values(f.game.state.playersById)[0]!.name).toBe("client-0");
  });

  it("keeps disconnected participants in the deadline instead of ending early", async () => {
    const f = await fixture();
    await f.start();
    await f.close(f.players[2]!);
    for (const p of f.players.slice(0, 2))
      await f.send(p, {
        type: "player_quiz_answer",
        turnId: f.game.state.turnId,
        answer: { variant: "mc4", selectedIndex: 0 },
      });
    expect(f.game.state.phase).toBe("quiz_answering");
    await f.due();
    expect(f.game.state.phase).toBe("round_results");
  });

  it("makes answers immutable, rejects stale turns and rejects answers after deadline", async () => {
    const f = await fixture();
    await f.start();
    const p = f.players[0]!;
    const playerId = p.state!.role === "player" ? p.state.playerId : "";
    const message = {
      type: "player_quiz_answer",
      turnId: f.game.state.turnId,
      answer: { variant: "mc4", selectedIndex: 0 },
    };
    await f.send(p, message);
    await f.send(p, { ...message, answer: { variant: "mc4", selectedIndex: 1 } });
    expect(f.game.state.quiz!.answers[playerId]).toMatchObject({ selectedIndex: 0 });
    await f.send(f.players[1]!, { ...message, turnId: "previous-turn" });
    expect(f.players[1]!.last).toMatchObject({ type: "error", code: "bad_phase" });
    vi.setSystemTime(f.game.state.deadlineAt!);
    await f.send(f.players[1]!, message);
    expect(f.game.state.phase).toBe("round_results");
    expect(f.game.state.quiz!.answers).toHaveProperty(playerId);
    expect(Object.keys(f.game.state.quiz!.answers)).toHaveLength(1);
  });

  it("requires a real screen to create a room and forbids late new joins", async () => {
    const f = await fixture();
    await f.start();
    const late = f.connect("late");
    await f.join(late, "late-client");
    expect(late.last).toMatchObject({ type: "error", code: "bad_phase" });
  });

  it("does not disconnect the new main screen when its replaced socket closes", async () => {
    const f = await fixture();
    await f.start();
    const next = f.connect("new-screen");
    await f.hello(next);
    await f.close(f.host);
    expect(f.game.state.hostConnected).toBe(true);
    expect(f.game.state.pausedAt).toBeNull();
  });

  it("pauses on media load failure and recovers on explicit retry", async () => {
    const f = await fixture();
    await f.chooseMode();
    await f.send(f.host, { type: "host_start_game" });
    await f.due();
    await f.due();
    expect(f.game.state.phase).toBe("playing");
    expect(f.game.state.pausedAt).not.toBeNull();
    await f.send(f.host, { type: "host_retry_media" });
    await f.send(f.host, { type: "host_media_ready", turnId: f.game.state.turnId });
    await f.due();
    expect(f.game.state.phase).toBe("quiz_answering");
  });

  it("ignores the retired Discord setting and rejects fast-test timings in production", async () => {
    const f = await fixture(false);
    await f.send(f.host, { type: "host_set_discord", enabled: true });
    await f.chooseMode();
    await f.send(f.host, { type: "host_start_game" });
    expect(f.alarmAt - Date.now()).toBe(2000);
    await f.due();
    await f.send(f.host, { type: "host_media_ready", turnId: f.game.state.turnId });
    expect(f.alarmAt - Date.now()).toBeGreaterThan(250);
    await f.due();
    expect(f.game.state.deadlineAt! - Date.now()).toBe(30_000);
  });

  it("freezes approved round versions for the entire game", async () => {
    const published = {
      id: 1_000_001,
      title: "Community original",
      audioFile: "/api/media/00000000-0000-0000-0000-000000000000",
      start: 0,
      end: 3,
      lyrics: [
        { id: 1, text: "Hint" },
        { id: 2, text: "Original answer" },
      ],
      hintLineIds: [1],
      revealLineIds: [2],
    };
    vi.spyOn(multiplayerRounds, "buildMultiplayerRoundOrder").mockReturnValueOnce([published]);
    const f = await fixture(false, async () => [published]);
    await f.start();
    published.title = "Edited after start";
    published.lyrics[1]!.text = "Changed answer";
    await f.restart();
    const frozen = f.game.state.roundSnapshots.find((round) => round.id === published.id)!;
    expect(frozen.title).toBe("Community original");
    expect(frozen.lyrics[1]!.text).toBe("Original answer");
  });

  it("detects a silent main screen even without a WebSocket close event", async () => {
    const f = await fixture();
    await f.start();
    vi.setSystemTime(Date.now() + 30_001);
    await f.game.onAlarm();
    expect(f.game.state.hostConnected).toBe(false);
    expect(f.game.state.pausedAt).not.toBeNull();
    await f.send(f.host, { type: "ping" });
    expect(f.game.state.hostConnected).toBe(true);
    expect(f.game.state.pausedAt).toBeNull();
  });

  it("never broadcasts player credentials", async () => {
    const f = await fixture();
    const snapshot = f.players[0]!.last;
    expect(JSON.stringify(snapshot)).not.toContain("secret-token");
    if (snapshot.type === "snapshot") expect(snapshot.state.players[0]).not.toHaveProperty("clientId");
  });
});

async function finishSession(f: Awaited<ReturnType<typeof fixture>>) {
  for (let step = 0; f.game.state.phase !== "finished" && step < 100; step++) {
    if (f.game.state.phase === "playing" && f.game.state.playingStartedAt === null)
      await f.send(f.host, { type: "host_media_ready", turnId: f.game.state.turnId });
    await f.due();
  }
  expect(f.game.state.phase).toBe("finished");
}

describe("personal state and final decisions", () => {
  it("restores only the authenticated player's accepted answer, without changing the background timeline", async () => {
    const f = await fixture();
    await f.start();
    const epoch = f.game.state.backgroundStartedAt;
    const answer = { variant: "mc4", selectedIndex: 1 };
    await f.send(f.players[0]!, { type: "player_quiz_answer", turnId: f.game.state.turnId, answer });
    expect(f.players[0]!.last).toMatchObject({ type: "snapshot", you: { own: { quizAnswer: answer } } });
    expect(f.players[1]!.last).toMatchObject({ type: "snapshot", you: { own: { quizAnswer: null } } });
    expect(f.host.last).toMatchObject({ type: "snapshot", you: { role: "host" } });
    expect(JSON.stringify(f.host.last)).not.toContain('"answers":');
    expect(f.host.last.type === "snapshot" && f.host.last.you.own).toBeUndefined();
    await f.close(f.players[0]!);
    const restored = f.connect("restored-answer");
    await f.join(restored, "client-0");
    await f.restart();
    await f.send(restored, { type: "ping" });
    expect(restored.last).toMatchObject({
      type: "snapshot",
      state: { backgroundStartedAt: epoch },
      you: { own: { quizAnswer: answer } },
    });
  });

  it("restores freestyle text and selected vote without exposing either to another player", async () => {
    const f = await fixture();
    await f.start("freestyle");
    const ids = f.players.map((p) => (p.state?.role === "player" ? p.state.playerId : ""));
    for (let n = 0; n < 3; n++)
      await f.send(f.players[n]!, {
        type: "player_freestyle_submit",
        turnId: f.game.state.turnId,
        text: `Private line ${n}`,
      });
    await f.send(f.players[0]!, { type: "player_vote", turnId: f.game.state.turnId, submissionId: ids[1] });
    await f.restart();
    await f.send(f.players[0]!, { type: "ping" });
    expect(f.players[0]!.last).toMatchObject({
      type: "snapshot",
      you: { own: { submission: "Private line 0", votedSubmissionId: ids[1] } },
    });
    await f.send(f.players[1]!, { type: "ping" });
    expect(f.players[1]!.last).toMatchObject({
      type: "snapshot",
      you: { own: { submission: "Private line 1", votedSubmissionId: null } },
    });
  });

  it("plays quiz then votes into freestyle in the same room with three players", async () => {
    const f = await fixture();
    await f.start();
    await finishSession(f);
    const ids = Object.keys(f.game.state.playersById);
    await f.send(f.players[0]!, { type: "player_final_vote", mode: "freestyle" });
    expect(f.game.state.finalVote?.decision).toBeNull();
    await f.restart();
    await f.send(f.players[1]!, { type: "player_final_vote", mode: "freestyle" });
    expect(f.game.state.finalVote?.decision).toMatchObject({ mode: "freestyle", random: false });
    await f.due();
    expect(f.game.state.mode).toBe("freestyle");
    expect(f.game.state.finalVote).toBeNull();
    expect(Object.keys(f.game.state.playersById)).toEqual(ids);
    expect(Object.values(f.game.state.playersById).every((p) => p.score === 0)).toBe(true);
    await finishSession(f);
  });

  it("draws only after all tied votes arrive and cannot schedule the next session twice", async () => {
    const f = await fixture(true, undefined, 4);
    await f.start();
    await finishSession(f);
    await f.send(f.players[0]!, { type: "player_final_vote", mode: "quiz" });
    expect(f.game.state.finalVote?.decision).toBeNull();
    await f.send(f.players[1]!, { type: "player_final_vote", mode: "freestyle" });
    expect(f.game.state.finalVote?.decision).toBeNull();
    await f.send(f.players[2]!, { type: "player_final_vote", mode: "quiz" });
    await f.send(f.players[3]!, { type: "player_final_vote", mode: "freestyle" });
    const decision = structuredClone(f.game.state.finalVote?.decision);
    expect(decision?.random).toBe(true);
    expect(["quiz", "freestyle"]).toContain(decision?.mode);
    await f.send(f.players[1]!, { type: "player_final_vote", mode: "quiz" });
    expect(f.game.state.finalVote?.decision).toEqual(decision);
    await f.due();
    const turn = f.game.state.turnId;
    await f.send(f.players[0]!, { type: "player_final_vote", mode: "quiz" });
    expect(f.players[0]!.last).toMatchObject({ type: "error", code: "bad_phase" });
    expect(f.game.state.turnId).toBe(turn);
  });

  it("replaces a player's vote and allows a strict majority before the final voter", async () => {
    const f = await fixture();
    await f.start();
    await finishSession(f);
    await f.send(f.host, { type: "player_final_vote", mode: "quiz" });
    expect(f.host.last).toMatchObject({ type: "error", code: "not_player" });
    await f.send(f.players[0]!, { type: "player_final_vote", mode: "quiz" });
    await f.send(f.players[0]!, { type: "player_final_vote", mode: "freestyle" });
    expect(Object.keys(f.game.state.finalVote!.votes)).toHaveLength(1);
    await f.send(f.players[1]!, { type: "player_final_vote", mode: "freestyle" });
    expect(f.game.state.finalVote?.decision).toMatchObject({ mode: "freestyle", random: false });
  });

  it("removes an exiting player, cancels a start below two, and admits a replacement", async () => {
    const f = await fixture(true, undefined, 2);
    await f.start();
    await finishSession(f);
    for (const p of f.players) await f.send(p, { type: "player_final_vote", mode: "quiz" });
    await f.send(f.players[0]!, { type: "player_leave" });
    expect(f.players[0]!.messages).toContainEqual({ type: "player_left" });
    expect(Object.keys(f.game.state.playersById)).toHaveLength(1);
    expect(f.game.state.finalVote?.decision).toBeNull();
    expect(f.game.state.nextAdvanceAt).toBeNull();
    const replacement = f.connect("replacement-player");
    await f.join(replacement, "replacement-client");
    expect(Object.keys(f.game.state.playersById)).toHaveLength(2);
    await f.send(replacement, { type: "player_final_vote", mode: "quiz" });
    expect(f.game.state.finalVote?.decision?.mode).toBe("quiz");
  });
});

describe("mode-specific player minimums", () => {
  it("allows quiz with two but rejects selecting or voting for freestyle", async () => {
    const f = await fixture(true, undefined, 2);
    await f.send(f.host, { type: "host_start_mode_select" });
    await f.send(f.host, { type: "host_select_mode", mode: "freestyle" });
    expect(f.host.last).toMatchObject({ type: "error", code: "bad_phase" });
    expect(f.game.state.phase).toBe("rules");
    expect(f.game.state.mode).toBe("quiz");
    await f.send(f.host, { type: "host_start_game" });
    await finishSession(f);
    await f.send(f.players[0]!, { type: "player_final_vote", mode: "freestyle" });
    expect(f.players[0]!.last).toMatchObject({ type: "error", code: "bad_phase" });
    expect(f.game.state.finalVote?.votes).toEqual({});
    for (const p of f.players) await f.send(p, { type: "player_final_vote", mode: "quiz" });
    await f.due();
    expect(f.game.state.mode).toBe("quiz");
    expect(f.game.state.phase).toBe("transition");
  });

  it("rechecks freestyle quorum at start and cancels a scheduled switch if the third player leaves", async () => {
    const f = await fixture();
    await f.start();
    await finishSession(f);
    await f.send(f.players[0]!, { type: "player_final_vote", mode: "freestyle" });
    await f.send(f.players[1]!, { type: "player_final_vote", mode: "freestyle" });
    expect(f.game.state.finalVote?.decision?.mode).toBe("freestyle");
    await f.close(f.players[2]!);
    expect(f.game.state.finalVote?.decision).toBeNull();
    expect(f.game.state.finalVote?.votes).toEqual({});
    expect(f.game.state.nextAdvanceAt).toBeNull();
    await f.send(f.host, { type: "host_restart_game" });
    expect(f.game.state.mode).toBe("quiz");
  });

  it("skips to quiz when a freestyle participant disconnects before starting", async () => {
    const f = await fixture();
    await f.chooseMode("freestyle");
    await f.close(f.players[2]!);
    expect(f.game.state.phase).toBe("rules");
    expect(f.game.state.mode).toBe("quiz");
    await f.send(f.host, { type: "host_start_game" });
    expect(f.game.state.phase).toBe("transition");
  });
});

describe("initial player mode ballot", () => {
  it("skips the ballot server-side for two players and locks the roster", async () => {
    const f = await fixture(true, undefined, 2);
    await f.send(f.host, { type: "host_start_mode_select" });
    expect(f.game.state).toMatchObject({
      phase: "rules",
      mode: "quiz",
      initialVote: null,
      rosterLocked: true,
    });
    const late = f.connect("late-in-rules");
    await f.join(late, "late-client");
    expect(late.last).toMatchObject({ type: "error", code: "bad_phase" });
    const reconnect = f.connect("same-player");
    await f.join(reconnect, "client-0");
    expect(reconnect.last).toMatchObject({ type: "snapshot", you: { role: "player", reconnected: true } });
    await f.close(f.players[0]!);
    await f.close(reconnect);
    expect(f.game.state).toMatchObject({ phase: "lobby", rosterLocked: false });
  });

  it("lets clients vote, replace choices and carry a majority through a restart", async () => {
    const f = await fixture();
    await f.send(f.host, { type: "host_start_mode_select" });
    await f.send(f.host, { type: "host_select_mode", mode: "quiz" });
    expect(f.host.last).toMatchObject({ type: "error", code: "bad_phase" });
    await f.send(f.players[0]!, { type: "player_mode_vote", mode: "quiz" });
    await f.send(f.players[0]!, { type: "player_mode_vote", mode: "freestyle" });
    expect(Object.values(f.game.state.initialVote!.votes)).toEqual(["freestyle"]);
    await f.send(f.players[1]!, { type: "player_mode_vote", mode: "freestyle" });
    expect(f.game.state.initialVote?.decision).toMatchObject({ mode: "freestyle", random: false });
    const late = f.connect("late-ballot");
    await f.join(late, "extra-player");
    expect(late.last).toMatchObject({ type: "error", code: "bad_phase" });
    await f.restart();
    await f.due();
    expect(f.game.state).toMatchObject({ phase: "rules", mode: "freestyle", rosterLocked: true });
  });

  it("uses a random tie-break after all four initial votes and never accepts host overrides", async () => {
    const f = await fixture(true, undefined, 4);
    await f.send(f.host, { type: "host_start_mode_select" });
    for (let i = 0; i < 4; i++)
      await f.send(f.players[i]!, { type: "player_mode_vote", mode: i % 2 ? "quiz" : "freestyle" });
    expect(f.game.state.initialVote?.decision?.random).toBe(true);
    await f.due();
    expect(f.game.state.phase).toBe("rules");
    await f.send(f.host, { type: "host_start_game" });
    await finishSession(f);
    await f.send(f.players[0]!, { type: "player_final_vote", mode: "quiz" });
    await f.send(f.host, { type: "host_restart_game" });
    expect(f.host.last).toMatchObject({ type: "error", code: "bad_phase" });
    expect(f.game.state.phase).toBe("finished");
  });
});

it("redacts unrevealed lyric lines in all snapshots until results", async () => {
  const f = await fixture();
  await f.start();
  const stored = f.game.state.roundSnapshots.find((round) => round.id === f.game.state.currentRoundId)!;
  const spectator = f.connect("observer");
  for (const socket of [f.host, f.players[0]!, spectator]) {
    const snapshot = socket.last;
    expect(snapshot.type).toBe("snapshot");
    if (snapshot.type === "snapshot") {
      expect(snapshot.state.round?.lyrics.map((line) => line.id)).toEqual(
        stored.lyrics.filter((line) => stored.hintLineIds.includes(line.id)).map((line) => line.id),
      );
      expect(snapshot.state.quiz?.correctIndex).toBeUndefined();
    }
  }
  await f.due();
  const snapshot = spectator.last;
  expect(snapshot.type === "snapshot" && snapshot.state.round?.lyrics).toEqual(stored.lyrics);
});

it("awards the exact freestyle match bonus using private lyrics after public redaction", async () => {
  const f = await fixture();
  await f.start("freestyle");
  const ids = f.players.map((player) => (player.state?.role === "player" ? player.state.playerId : ""));
  const texts = ["Откуда в жопе бриллианты", "абсолютно другой ответ", "никто не знает"];
  for (let n = 0; n < 3; n++)
    await f.send(f.players[n]!, {
      type: "player_freestyle_submit",
      turnId: f.game.state.turnId,
      text: texts[n],
    });
  for (let n = 0; n < 3; n++)
    await f.send(f.players[n]!, {
      type: "player_vote",
      turnId: f.game.state.turnId,
      submissionId: ids[n === 0 ? 1 : 0],
    });
  expect(f.game.state.phase).toBe("round_results");
  expect(f.game.state.roundResult).toMatchObject({
    kind: "freestyle",
    submissions: expect.arrayContaining([
      expect.objectContaining({ playerId: ids[0], similarityBonus: true, tieBrokenWinner: true, votes: 2 }),
    ]),
  });
  expect(f.game.state.playersById[ids[0]!]!.score).toBe(2);
});

describe("freestyle vote and similarity awards", () => {
  it("awards a 40–50% match independently and awards no voting points when nobody votes", async () => {
    const f = await fixture();
    await f.start("freestyle");
    const ids = f.players.map((p) => (p.state?.role === "player" ? p.state.playerId : ""));
    for (let n = 0; n < 3; n++)
      await f.send(f.players[n]!, {
        type: "player_freestyle_submit",
        turnId: f.game.state.turnId,
        text: n === 0 ? "бриллианты!!!" : "zzzz qqqq xxxx",
      });
    expect(f.game.state.phase).toBe("freestyle_voting");
    for (const socket of [f.host, ...f.players]) {
      expect(socket.last.type).toBe("snapshot");
      if (socket.last.type === "snapshot") {
        expect(socket.last.state.roundResult).toBeNull();
        const round = socket.last.state.round!;
        expect(round.lyrics.every((line) => round.hintLineIds.includes(line.id))).toBe(true);
      }
    }
    await f.due();
    const result = f.game.state.roundResult;
    expect(result).toMatchObject({ kind: "freestyle", similarityThreshold: 0.4, winnerPlayerIds: [] });
    if (result?.kind !== "freestyle") throw new Error("Missing result");
    const mine = result.submissions.find((item) => item.playerId === ids[0])!;
    expect(mine).toMatchObject({
      similarityBonus: true,
      tieBrokenWinner: false,
      votingWinner: false,
    });
    expect(mine.similarity).toBeGreaterThanOrEqual(0.4);
    expect(mine.similarity).toBeLessThan(0.5);
    expect(f.game.state.playersById[ids[0]!]!.score).toBe(1);
    expect(f.game.state.playersById[ids[1]!]!.score).toBe(0);
    expect(f.game.state.playersById[ids[2]!]!.score).toBe(0);
  });

  it.each([0, 0xffffffff])(
    "uses the lottery for positive ties and persists its single award (%i)",
    async (random) => {
      const f = await fixture();
      await f.start("freestyle");
      const ids = f.players.map((p) => (p.state?.role === "player" ? p.state.playerId : ""));
      for (const player of f.players)
        await f.send(player, {
          type: "player_freestyle_submit",
          turnId: f.game.state.turnId,
          text: "zzzz qqqq xxxx",
        });
      const sorted = Object.keys(f.game.state.freestyle!.submissions).sort((a, b) => a.localeCompare(b));
      const rng = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
        if (array instanceof Uint32Array) array.fill(random);
        return array;
      });
      for (let n = 0; n < 3; n++)
        await f.send(f.players[n]!, {
          type: "player_vote",
          turnId: f.game.state.turnId,
          submissionId: ids[(n + 1) % 3],
        });
      expect(rng).toHaveBeenCalled();
      const result = structuredClone(f.game.state.roundResult);
      expect(result).toMatchObject({ kind: "freestyle", winnerPlayerIds: [sorted[random ? 2 : 0]] });
      if (result?.kind !== "freestyle") throw new Error("Missing result");
      expect(result.tieBreakNote).toContain("жеребьёвка");
      expect(result.submissions.filter((s) => s.votingWinner)).toHaveLength(1);
      expect(Object.values(f.game.state.playersById).reduce((sum, p) => sum + p.score, 0)).toBe(1);
      rng.mockRestore();
      await f.restart();
      await f.game.onAlarm();
      expect(f.game.state.roundResult).toEqual(result);
      expect(Object.values(f.game.state.playersById).reduce((sum, p) => sum + p.score, 0)).toBe(1);
    },
  );
});

describe("manual pause and shared replay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());
  it("keeps manual pause through host reconnect and preserves answer time", async () => {
    const f = await fixture();
    await f.start();
    const remaining = f.game.state.deadlineAt! - Date.now();
    await f.send(f.host, { type: "host_pause", paused: true });
    vi.setSystemTime(Date.now() + 2000);
    await f.close(f.host);
    const replacement = f.connect("replacement");
    await f.hello(replacement);
    expect(f.game.state.manualPaused).toBe(true);
    expect(f.game.state.pausedAt).not.toBeNull();
    await f.send(f.players[0]!, {
      type: "player_quiz_answer",
      turnId: f.game.state.turnId,
      answer: { variant: "mc4", selectedIndex: 0 },
    });
    expect(Object.keys(f.game.state.quiz!.answers)).toHaveLength(0);
    await f.send(replacement, { type: "host_pause", paused: false });
    expect(f.game.state.deadlineAt! - Date.now()).toBe(remaining);
  });
  it("reserves one replay, ignores stale readiness, resumes timer after fragment", async () => {
    const f = await fixture();
    await f.start();
    const remaining = f.game.state.deadlineAt! - Date.now();
    await f.send(f.players[0]!, { type: "player_replay", turnId: f.game.state.turnId });
    const replayId = f.game.state.replay!.id;
    expect(f.game.state.deadlineAt).toBeNull();
    await f.send(f.players[1]!, { type: "player_replay", turnId: f.game.state.turnId });
    expect(f.game.state.replay!.id).toBe(replayId);
    await f.send(f.host, { type: "host_media_ready", turnId: f.game.state.turnId, replayId: "stale" });
    expect(f.game.state.replay!.startedAt).toBeNull();
    await f.send(f.host, { type: "host_media_ready", turnId: f.game.state.turnId, replayId });
    await f.due();
    expect(f.game.state.replay).toBeNull();
    expect(f.game.state.deadlineAt! - Date.now()).toBe(remaining);
  });
  it("accepts answers during replay and blocks replay from an answered player", async () => {
    const f = await fixture();
    await f.start();
    const turnId = f.game.state.turnId;
    await f.send(f.players[0]!, {
      type: "player_quiz_answer",
      turnId,
      answer: { variant: "mc4", selectedIndex: 0 },
    });
    await f.send(f.players[0]!, { type: "player_replay", turnId });
    expect(f.game.state.replay).toBeNull();
    await f.send(f.players[1]!, { type: "player_replay", turnId });
    for (const p of f.players.slice(1))
      await f.send(p, { type: "player_quiz_answer", turnId, answer: { variant: "mc4", selectedIndex: 0 } });
    expect(f.game.state.phase).toBe("round_results");
    expect(f.game.state.replay).toBeNull();
  });
  it("allows leaving during pause and safely ends an under-quorum session", async () => {
    const f = await fixture(true, undefined, 2);
    await f.start();
    await f.send(f.host, { type: "host_pause", paused: true });
    await f.send(f.players[0]!, { type: "player_leave" });
    expect(f.game.state.phase).toBe("finished");
    expect(f.game.state.pausedAt).toBeNull();
    expect(Object.keys(f.game.state.playersById)).toHaveLength(1);
  });
  it("returns rules to unlocked lobby without losing participants", async () => {
    const f = await fixture();
    await f.chooseMode();
    await f.send(f.host, { type: "host_return_lobby" });
    expect(f.game.state.phase).toBe("lobby");
    expect(f.game.state.initialVote).toBeNull();
    expect(f.game.state.rosterLocked).toBe(false);
    expect(Object.keys(f.game.state.playersById)).toHaveLength(3);
  });
});

it("ends replay when the only unanswered player leaves and quiz quorum survives", async () => {
  const f = await fixture();
  await f.start();
  const turnId = f.game.state.turnId;
  await f.send(f.players[2]!, { type: "player_replay", turnId });
  for (const p of f.players.slice(0, 2))
    await f.send(p, { type: "player_quiz_answer", turnId, answer: { variant: "mc4", selectedIndex: 0 } });
  await f.send(f.players[2]!, { type: "player_leave" });
  expect(f.game.state.phase).toBe("round_results");
  expect(f.game.state.replay).toBeNull();
});

it("returns to lobby if a rules-stage departure removes the minimum roster", async () => {
  const f = await fixture(true, undefined, 2);
  await f.chooseMode();
  await f.send(f.players[0]!, { type: "player_leave" });
  expect(f.game.state).toMatchObject({ phase: "lobby", rosterLocked: false, mode: null });
});

it("keeps a completed roster frozen during pause and advances on explicit resume", async () => {
  const f = await fixture();
  await f.start();
  for (const p of f.players.slice(0, 2))
    await f.send(p, {
      type: "player_quiz_answer",
      turnId: f.game.state.turnId,
      answer: { variant: "mc4", selectedIndex: 0 },
    });
  await f.send(f.host, { type: "host_pause", paused: true });
  await f.send(f.players[2]!, { type: "player_leave" });
  expect(f.game.state.phase).toBe("quiz_answering");
  await f.send(f.host, { type: "host_pause", paused: false });
  expect(f.game.state.phase).toBe("round_results");
});

it("preserves an accepted answer and identity through repeated paused replacements and persistence", async () => {
  const f = await fixture();
  await f.start();
  let old = f.players[0]!;
  const playerId = old.state?.role === "player" ? old.state.playerId : "";
  await f.send(old, {
    type: "player_quiz_answer",
    turnId: f.game.state.turnId,
    answer: { variant: "mc4", selectedIndex: 0 },
  });
  await f.send(f.host, { type: "host_pause", paused: true });
  for (let attempt = 0; attempt < 5; attempt++) {
    const replacement = f.connect(`replacement-${attempt}`);
    await f.join(replacement, "client-0");
    await f.close(old);
    expect(replacement.state).toMatchObject({ role: "player", playerId });
    expect(f.game.state.playersById[playerId]?.connected).toBe(true);
    expect(f.game.state.quiz?.answers[playerId]).toEqual({ variant: "mc4", selectedIndex: 0 });
    expect(Object.keys(f.game.state.playersById)).toHaveLength(3);
    if (attempt === 2) await f.restart();
    expect(f.game.state.manualPaused).toBe(true);
    old = replacement;
  }
});

describe("hostless online sessions", () => {
  const playerIds = (f: Awaited<ReturnType<typeof fixture>>) =>
    f.players.map((p) => (p.state?.role === "player" ? p.state.playerId : ""));
  async function begin(
    f: Awaited<ReturnType<typeof fixture>>,
    mode: "quiz" | "freestyle" = "quiz",
    loaded = f.players.length,
  ) {
    for (const player of f.players) await f.send(player, { type: "player_ready" });
    expect(f.game.state.phase).toBe("mode_select");
    if (f.players.length >= 3)
      for (const player of f.players) await f.send(player, { type: "player_mode_vote", mode });
    await f.due();
    expect(f.game.state.phase).toBe("transition");
    for (const player of f.players.slice(0, loaded))
      await f.send(player, { type: "player_media_ready", turnId: f.game.state.turnId });
    await f.due();
    if (f.game.state.phase === "transition") {
      vi.setSystemTime(f.game.state.online!.mediaLoadDeadlineAt!);
      await f.game.onAlarm();
    }
    expect(f.game.state.phase).toBe("playing");
    await f.due();
  }
  it("starts with two ready players, needs no host, and rejects host takeover and unreserved joins", async () => {
    const f = await fixture(true, undefined, 2, true);
    expect(f.game.state.hostToken).toBeNull();
    await f.hello();
    expect(f.host.last).toMatchObject({ type: "error", code: "not_host" });
    const intruder = f.connect("intruder");
    await f.join(intruder, "intruder-client");
    expect(intruder.last).toMatchObject({ type: "error", code: "invalid_room" });
    await begin(f);
    expect(f.game.state).toMatchObject({
      mode: "quiz",
      totalRounds: 5,
      phase: "quiz_answering",
      pausedAt: null,
      hostConnected: false,
    });
    const deadline = f.game.state.deadlineAt;
    await f.restart();
    expect(f.game.state.pausedAt).toBeNull();
    expect(f.game.state.deadlineAt).toBe(deadline);
    expect(await f.game.reserveOnline("late-client", "secret-token-late-client")).toBe(false);
  });
  it("removes unready players after the lobby deadline and starts for the ready pair", async () => {
    const f = await fixture(true, undefined, 3, true);
    await f.send(f.players[0]!, { type: "player_ready" });
    await f.send(f.players[1]!, { type: "player_ready" });
    vi.setSystemTime(f.game.state.online!.readyDeadlineAt!);
    await f.game.onAlarm();
    expect(f.players[2]!.messages).toContainEqual({ type: "player_left" });
    expect(f.game.state.phase).toBe("mode_select");
    expect(f.game.state.initialVote?.decision?.mode).toBe("quiz");
  });
  it("returns a lone ready player to search and rechecks mode quorum before starting", async () => {
    const waiting = await fixture(true, undefined, 2, true);
    await waiting.send(waiting.players[0]!, { type: "player_ready" });
    vi.setSystemTime(waiting.game.state.online!.readyDeadlineAt!);
    await waiting.game.onAlarm();
    for (const p of waiting.players) expect(p.messages).toContainEqual({ type: "player_left" });
    expect(Object.keys(waiting.game.state.playersById)).toHaveLength(0);
    const f = await fixture(true, undefined, 3, true);
    for (const p of f.players) await f.send(p, { type: "player_ready" });
    await f.send(f.players[0]!, { type: "player_mode_vote", mode: "freestyle" });
    await f.send(f.players[1]!, { type: "player_mode_vote", mode: "freestyle" });
    await f.close(f.players[2]!);
    expect(f.game.state.initialVote?.decision?.mode).toBe("quiz");
    await f.due();
    expect(f.game.state.mode).toBe("quiz");
  });
  it("caps reservations at six and refuses a new participant who arrives after roster lock", async () => {
    const f = await fixture(true, undefined, 6, true);
    expect(await f.game.reserveOnline("client-too-many", "secret-token-too-many")).toBe(false);
    const pair = await fixture(true, undefined, 2, true);
    expect(await pair.game.reserveOnline("client-late", "secret-token-client-late")).toBe(true);
    for (const p of pair.players) await pair.send(p, { type: "player_ready" });
    const late = pair.connect("late-reserved-socket");
    await pair.join(late, "client-late");
    expect(late.messages).toContainEqual({ type: "player_left" });
    expect(await pair.game.reserveOnline("client-late", "secret-token-client-late")).toBe(false);
  });
  it("times out mode voting to quiz and excludes an unloaded client from answering and voting", async () => {
    const f = await fixture(true, undefined, 3, true);
    for (const p of f.players) await f.send(p, { type: "player_ready" });
    vi.setSystemTime(f.game.state.online!.modeVoteDeadlineAt!);
    await f.game.onAlarm();
    expect(f.game.state.initialVote?.decision?.mode).toBe("quiz");
    await f.due();
    for (const p of f.players.slice(0, 2))
      await f.send(p, { type: "player_media_ready", turnId: f.game.state.turnId });
    vi.setSystemTime(f.game.state.online!.mediaLoadDeadlineAt!);
    await f.game.onAlarm();
    await f.due();
    await f.send(f.players[2]!, {
      type: "player_quiz_answer",
      turnId: f.game.state.turnId,
      answer: { variant: "mc4", selectedIndex: 0 },
    });
    expect(f.players[2]!.last).toMatchObject({ type: "error", code: "bad_phase" });
    expect(f.game.state.online!.eligiblePlayerIds).toHaveLength(2);
    expect(f.game.state.quiz!.answeredPlayerIds).toHaveLength(0);
    expect(f.game.state.pausedAt).toBeNull();
  });
  it("keeps replay private, enforces cooldown and keeps the authoritative answer deadline", async () => {
    const f = await fixture(true, undefined, 2, true);
    await begin(f);
    const ids = playerIds(f);
    const deadline = f.game.state.deadlineAt;
    await f.send(f.players[0]!, { type: "player_replay", turnId: f.game.state.turnId });
    const replay = f.game.state.onlineReplays![ids[0]!]!;
    expect(replay.endsAt).toBeGreaterThan(replay.startedAt);
    expect(f.game.state.deadlineAt).toBe(deadline);
    expect(f.game.state.replay).toBeNull();
    const other = f.players[1]!.last;
    expect(other.type === "snapshot" && other.you.own?.personalReplay).toBeNull();
    await f.send(f.players[0]!, { type: "player_replay", turnId: f.game.state.turnId });
    expect(f.game.state.onlineReplays![ids[0]!]).toEqual(replay);
    await f.send(f.players[0]!, {
      type: "player_quiz_answer",
      turnId: f.game.state.turnId,
      answer: { variant: "mc4", selectedIndex: 0 },
    });
    const own = f.players[0]!.last;
    expect(own.type === "snapshot" && own.you.own?.personalReplay).toEqual(replay);
    expect(JSON.stringify(other)).not.toContain("onlineReservations");
    expect(JSON.stringify(other)).not.toContain("secret-token");
  });
  it("continues timers on disconnect, allows token-bound recovery and ends early after quorum grace", async () => {
    const f = await fixture(true, undefined, 3, true);
    await begin(f, "freestyle");
    const ids = playerIds(f);
    const deadline = f.game.state.deadlineAt;
    await f.close(f.players[2]!);
    expect(f.game.state.pausedAt).toBeNull();
    expect(f.game.state.deadlineAt).toBe(deadline);
    expect(f.game.state.online!.quorumDeadlineAt).not.toBeNull();
    const replacement = f.connect("replacement-online");
    await f.join(replacement, "client-2");
    expect(replacement.state).toMatchObject({ role: "player", playerId: ids[2] });
    expect(f.game.state.online!.quorumDeadlineAt).toBeNull();
    await f.close(replacement);
    const grace = f.game.state.online!.quorumDeadlineAt!;
    for (let n = 0; n < 3; n++) {
      vi.setSystemTime(Date.now() + 10000);
      for (const p of f.players.slice(0, 2)) await f.send(p, { type: "ping" });
    }
    vi.setSystemTime(grace);
    await f.game.onAlarm();
    expect(f.game.state.phase).toBe("finished");
    expect(f.game.state.online!.endedEarly).toBe(true);
    expect(f.game.state.pausedAt).toBeNull();
  });
  it("runs five freestyle rounds and rematches the same ready players without a host", async () => {
    const f = await fixture(true, undefined, 3, true);
    await begin(f, "freestyle");
    for (let round = 0; round < 5; round++) {
      expect(f.game.state.phase).toBe("freestyle_submitting");
      for (const p of f.players)
        await f.send(p, {
          type: "player_freestyle_submit",
          turnId: f.game.state.turnId,
          text: "произвольный ответ",
        });
      const ids = playerIds(f);
      for (const option of f.game.state.freestyle!.votingOptions) {
        expect(ids).not.toContain(option.submissionId);
        expect(option.submittedAt).toBe(0);
      }
      for (let n = 0; n < 3; n++)
        await f.send(f.players[n]!, {
          type: "player_vote",
          turnId: f.game.state.turnId,
          submissionId: f.game.state.onlineSubmissionIds![ids[(n + 1) % 3]!]!,
        });
      expect(f.game.state.phase).toBe("round_results");
      await f.due();
      if (round < 4) {
        for (const p of f.players)
          await f.send(p, { type: "player_media_ready", turnId: f.game.state.turnId });
        await f.due();
        await f.due();
      }
    }
    expect(f.game.state.phase).toBe("finished");
    expect(f.game.state.online!.endedEarly).toBe(false);
    const ids = playerIds(f);
    const completedScore = f.game.state.playersById[ids[0]!]!.score;
    await f.send(f.players[0]!, { type: "player_leave" });
    expect(f.game.state.playersById[ids[0]!]!.score).toBe(completedScore);
    for (const p of f.players.slice(1)) await f.send(p, { type: "player_rematch" });
    expect(f.game.state.phase).toBe("mode_select");
    expect(Object.keys(f.game.state.playersById)).toHaveLength(2);
    expect(f.game.state.initialVote?.decision?.mode).toBe("quiz");
    expect(f.game.state.hostToken).toBeNull();
  });
});

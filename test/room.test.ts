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

async function fixture(testMode = true, publishedRounds?: RoomRuntime["publishedRounds"], playerCount = 3) {
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
  await hello();
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

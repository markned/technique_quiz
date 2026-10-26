// Local smoke load, not a capacity guarantee for production or an internet connection.
const base = process.env.MULTIPLAYER_LOAD_URL ?? "ws://localhost:1999";
let endpoint;
try {
  endpoint = new URL(base);
} catch {
  console.error(JSON.stringify({ ok: false, error: "Invalid local load URL" }));
  process.exit(1);
}
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) ||
  !["ws:", "wss:"].includes(endpoint.protocol)
) {
  console.error(JSON.stringify({ ok: false, error: "Use a loopback test server for load testing" }));
  process.exit(1);
}
const sockets = new Set();
let failure;
let finishing = false;
let reconnects = 0;
const startedAt = Date.now();
const timeout = setTimeout(() => {
  finishing = true;
  failure = new Error("Load test timed out");
  console.error(JSON.stringify({ ok: false, error: failure.message }));
  for (const socket of sockets) socket.close();
  process.exitCode = 1;
}, 45_000);
function connect(code, hello) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base}/parties/main/${code}`);
    sockets.add(socket);
    const client = {
      socket,
      state: null,
      you: null,
      retired: false,
      send(message) {
        socket.send(JSON.stringify(message));
      },
    };
    socket.addEventListener("open", () => client.send(hello));
    socket.addEventListener("error", () => {
      failure = new Error(`Socket failed in ${code}`);
      reject(failure);
    });
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        failure = new Error(`${code}: invalid JSON from server`);
        reject(failure);
        return;
      }
      if (message.type === "error") {
        // Replacing a connection deliberately retires the old socket.
        if (message.code === "session_replaced") {
          client.retired = true;
          return;
        }
        failure = new Error(`${code}: ${message.code}: ${message.message}`);
        reject(failure);
        return;
      }
      if (message.type !== "snapshot" || message.you.role === "spectator") return;
      client.state = message.state;
      client.you = message.you;
      resolve(client);
    });
    socket.addEventListener("close", (event) => {
      sockets.delete(socket);
      if (!finishing && !client.retired && !failure) {
        failure = new Error(`${code}: unexpected socket close (${event.code})`);
        reject(failure);
      }
    });
  });
}
function waitUntil(predicate) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (failure) {
        clearInterval(tick);
        reject(failure);
      } else if (predicate()) {
        clearInterval(tick);
        resolve();
      } else if (Date.now() - started > 30_000) {
        clearInterval(tick);
        reject(new Error("Room stalled"));
      }
    }, 20);
  });
}
try {
  const healthUrl = new URL("/health", base.replace(/^ws/, "http"));
  const health = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) }).then((r) => r.json());
  if (health.testMode !== true)
    throw new Error("Load requires a local party:test server with TEST_MODE=true");
  const stamp = Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, "0")
    .toUpperCase()
    .replace(/^F/, "G");
  const rooms = await Promise.all(
    Array.from({ length: 10 }, async (_, roomIndex) => {
      const code = `E2E${stamp}${roomIndex}`;
      const host = await connect(code, {
        type: "host_hello",
        clientId: `host-client-${roomIndex}-${stamp}`,
        hostToken: `host-secret-${roomIndex}-${stamp}`,
      });
      const players = await Promise.all(
        Array.from({ length: 10 }, (_, n) =>
          connect(code, {
            type: "player_join",
            clientId: `player-${stamp}-${roomIndex}-${n}`,
            name: `Player ${n}`,
            playerToken: `player-secret-${stamp}-${roomIndex}-${n}`,
          }),
        ),
      );
      return { code, host, players, roomIndex };
    }),
  );
  await waitUntil(() => rooms.every(({ host }) => host.state.players.length === 10));
  await Promise.all(
    rooms.map(async ({ code, host, players, roomIndex }) => {
      host.send({ type: "host_start_mode_select" });
      await waitUntil(() => host.state.phase === "mode_select");
      for (const player of players) player.send({ type: "player_mode_vote", mode: "quiz" });
      await waitUntil(() => host.state.phase === "rules");
      host.send({ type: "host_start_game" });
      await waitUntil(() => host.state.phase === "playing");
      // Replace half the sockets while old close events are still in flight.
      for (let n = 0; n < 5; n++) {
        const old = players[n];
        const next = await connect(code, {
          type: "player_join",
          clientId: `player-${stamp}-${roomIndex}-${n}`,
          name: `Player ${n}`,
          playerToken: `player-secret-${stamp}-${roomIndex}-${n}`,
        });
        if (next.you.playerId !== old.you.playerId) throw new Error("Identity changed on reconnect");
        players[n] = next;
        reconnects++;
        old.retired = true;
        old.socket.close();
      }
      await waitUntil(() => host.state.players.every((player) => player.connected));
      const handled = new Set();
      const resultsSeen = new Set();
      const expectedScores = new Map(players.map((p) => [p.you.playerId, 0]));
      host.socket.addEventListener("message", () => {
        const state = host.state;
        if (
          state?.phase === "round_results" &&
          state.roundResult?.kind === "quiz" &&
          !resultsSeen.has(state.turnId)
        ) {
          resultsSeen.add(state.turnId);
          for (const id of state.roundResult.correctPlayerIds)
            expectedScores.set(id, (expectedScores.get(id) ?? 0) + 1);
        }
        if (state?.phase === "playing" && !handled.has(state.turnId)) {
          handled.add(state.turnId);
          host.send({ type: "host_media_ready", turnId: state.turnId });
        }
      });
      host.send({ type: "host_media_ready", turnId: host.state.turnId });
      for (const player of players) {
        const answered = new Set();
        const answerCurrent = () => {
          const state = player.state;
          if (state?.phase !== "quiz_answering" || answered.has(state.turnId)) return;
          answered.add(state.turnId);
          const answer =
            state.quiz.variant === "mc4"
              ? { variant: "mc4", selectedIndex: 0 }
              : { variant: "order", orderIds: state.quiz.orderLineIds };
          player.send({ type: "player_quiz_answer", turnId: state.turnId, answer });
        };
        player.socket.addEventListener("message", answerCurrent);
        answerCurrent();
      }
      await waitUntil(() => host.state.phase === "finished");
      if (
        resultsSeen.size !== host.state.totalRounds ||
        host.state.leaderboard.length !== players.length ||
        host.state.leaderboard.some((row) => expectedScores.get(row.playerId) !== row.score)
      )
        throw new Error(`${code}: final scores disagree with authoritative round results`);
      const expected = JSON.stringify(host.state.leaderboard);
      await waitUntil(() =>
        players.every(
          (player) =>
            player.state.phase === "finished" && JSON.stringify(player.state.leaderboard) === expected,
        ),
      );
    }),
  );
  console.log(
    JSON.stringify({
      ok: true,
      rooms: rooms.length,
      players: 100,
      reconnects,
      rounds: rooms.map((r) => r.host.state.totalRounds),
      consistentFinalResults: true,
      durationMs: Date.now() - startedAt,
    }),
  );
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, durationMs: Date.now() - startedAt }));
  process.exitCode = 1;
} finally {
  finishing = true;
  clearTimeout(timeout);
  for (const socket of sockets) socket.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 2000).unref();
}

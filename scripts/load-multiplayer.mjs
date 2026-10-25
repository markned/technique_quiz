// Local smoke load, not a capacity guarantee for production or an internet connection.
const base = process.env.MULTIPLAYER_LOAD_URL ?? "ws://localhost:1999";
if (!/localhost|127\.0\.0\.1/.test(new URL(base).hostname))
  throw new Error("Use a local server for this load test.");
const sockets = new Set();
const timeout = setTimeout(() => {
  console.error("Load test timed out");
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
      send(message) {
        socket.send(JSON.stringify(message));
      },
    };
    socket.addEventListener("open", () => client.send(hello));
    socket.addEventListener("error", reject, { once: true });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "error") {
        reject(new Error(message.message));
        return;
      }
      if (message.you.role === "spectator") return;
      client.state = message.state;
      client.you = message.you;
      resolve(client);
    });
    socket.addEventListener("close", () => sockets.delete(socket));
  });
}
function waitUntil(predicate) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (predicate()) {
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
  const stamp = Date.now().toString(36).slice(-2).toUpperCase();
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
      host.send({ type: "host_select_mode", mode: "quiz" });
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
        old.socket.close();
      }
      await waitUntil(() => host.state.players.every((player) => player.connected));
      const handled = new Set();
      host.socket.addEventListener("message", () => {
        const state = host.state;
        if (state?.phase === "playing" && !handled.has(state.turnId)) {
          handled.add(state.turnId);
          host.send({ type: "host_media_ready", turnId: state.turnId });
        }
      });
      host.send({ type: "host_media_ready", turnId: host.state.turnId });
      for (const player of players) {
        const answered = new Set();
        player.socket.addEventListener("message", () => {
          const state = player.state;
          if (state?.phase !== "quiz_answering" || answered.has(state.turnId)) return;
          answered.add(state.turnId);
          const answer =
            state.quiz.variant === "mc4"
              ? { variant: "mc4", selectedIndex: 0 }
              : { variant: "order", orderIds: state.quiz.orderLineIds };
          player.send({ type: "player_quiz_answer", turnId: state.turnId, answer });
        });
      }
      await waitUntil(() => host.state.phase === "finished");
      const expected = JSON.stringify(host.state.leaderboard);
      await waitUntil(() =>
        players.every(
          (player) =>
            player.state.phase === "finished" && JSON.stringify(player.state.leaderboard) === expected,
        ),
      );
    }),
  );
  console.log("Passed: 10 rooms, 100 players, 50 reconnects, 3 rounds per room, identical final results.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  for (const socket of sockets) socket.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 2000).unref();
}

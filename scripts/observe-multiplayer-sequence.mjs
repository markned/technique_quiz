import assert from "node:assert/strict";

const [code, count = "3", base = "ws://localhost:2001"] = process.argv.slice(2);
if (!code || !["2", "3"].includes(count))
  throw new Error("Usage: node scripts/observe-multiplayer-sequence.mjs ROOM_CODE 2|3 [ws://localhost:2001]");
const players = Number(count);
const socket = new WebSocket(`${base}/parties/main/${code}`);
const rounds = { quiz: new Set(), freestyle: new Set() };
let last = "",
  initialBallot = false,
  quizFinished = false,
  switched = false,
  done = false;
const timeout = setTimeout(() => finish(new Error("Sequence timed out")), 180_000);
function finish(error) {
  if (done) return;
  done = true;
  clearTimeout(timeout);
  socket.close();
  if (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  setTimeout(() => process.exit(process.exitCode ?? 0), 200);
}
socket.addEventListener("message", (event) => {
  try {
    const message = JSON.parse(String(event.data));
    if (message.type !== "snapshot") return;
    const state = message.state;
    if (state.phase === "mode_select") initialBallot = true;
    if (state.phase === "round_results" && state.mode) rounds[state.mode].add(state.currentRoundIndex);
    if (state.quiz) assert.equal(state.quiz.variant, "mc4", "Order question in multiplayer");
    if (state.finalVote?.decision?.mode === "freestyle") switched = true;
    const stage = `${state.mode ?? "lobby"} ${state.phase} ${Math.min(state.currentRoundIndex + 1, state.totalRounds)}/${state.totalRounds}`;
    if (stage !== last) {
      last = stage;
      console.log(stage);
    }
    if (state.phase === "finished" && state.mode === "quiz") quizFinished = true;
    if (state.phase === "finished" && state.mode === (players === 2 ? "quiz" : "freestyle")) {
      assert.equal(state.players.length, players);
      assert.equal(rounds.quiz.size, 14);
      assert.equal(quizFinished, true);
      assert.equal(initialBallot, players > 2);
      if (players > 2) {
        assert.equal(rounds.freestyle.size, 8);
        assert.equal(switched, true);
      }
      console.log(
        JSON.stringify({
          passed: true,
          players,
          quizRounds: rounds.quiz.size,
          freestyleRounds: rounds.freestyle.size,
          initialBallot,
          switched,
        }),
      );
      finish();
    }
  } catch (error) {
    finish(error);
  }
});
socket.addEventListener("error", () => finish(new Error("Observer connection failed")));

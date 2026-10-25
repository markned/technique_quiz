import { useEffect, useState } from "react";
import type { PublicRoomState } from "../multiplayer/types";
import type { ClientMessage } from "../multiplayer/messages";

/** Local preview only: uses the actual server protocol and never supplies correct answers. */
export function useSimulation(
  state: PublicRoomState | null,
  playerId: string | undefined,
  role: string,
  send: (message: ClientMessage) => boolean,
) {
  const [automatic, setAutomatic] = useState(false);
  const params = new URLSearchParams(window.location.search);
  const active = import.meta.env.DEV && !!params.get("simClient");
  const index = Number(params.get("simIndex") ?? 0);
  useEffect(() => {
    if (!active) return;
    const receive = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.source === window.parent &&
        event.data?.type === "simulation-auto"
      )
        setAutomatic(event.data.enabled === true);
    };
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "simulation-ready" }, window.location.origin);
    return () => window.removeEventListener("message", receive);
  }, [active]);
  let action: ClientMessage | undefined;
  if (active && automatic && state && !state.pausedAt) {
    if (role === "host") {
      if (
        state.phase === "lobby" &&
        state.players.filter((player) => player.connected).length >= state.minPlayers
      )
        action = { type: "host_start_mode_select" };
      if (state.phase === "rules") action = { type: "host_start_game" };
    } else if (playerId) {
      if (
        state.phase === "mode_select" &&
        !state.initialVote?.votes[playerId] &&
        !state.initialVote?.decision
      )
        action = { type: "player_mode_vote", mode: "quiz" };
      if (
        state.phase === "finished" &&
        state.mode === "quiz" &&
        state.players.filter((player) => player.connected).length >= 3 &&
        !state.finalVote?.votes[playerId] &&
        !state.finalVote?.decision
      )
        action = { type: "player_final_vote", mode: "freestyle" };
      if (state.phase === "quiz_answering" && state.quiz && !state.quiz.answeredPlayerIds.includes(playerId))
        action = {
          type: "player_quiz_answer",
          turnId: state.turnId,
          answer:
            state.quiz.variant === "mc4"
              ? { variant: "mc4", selectedIndex: index % 4 }
              : {
                  variant: "order",
                  orderIds: index % 2 ? [...state.quiz.orderLineIds].reverse() : state.quiz.orderLineIds,
                },
        };
      if (state.phase === "freestyle_submitting" && !state.freestyle?.submittedPlayerIds.includes(playerId))
        action = {
          type: "player_freestyle_submit",
          turnId: state.turnId,
          text: ["И снова музыка звучит", "Весь город знает этот ритм", "Мы продолжаем до утра"][index % 3],
        };
      const option = state.freestyle?.votingOptions.find((item) => item.submissionId !== playerId);
      if (state.phase === "freestyle_voting" && option && !state.freestyle?.votedPlayerIds.includes(playerId))
        action = { type: "player_vote", turnId: state.turnId, submissionId: option.submissionId };
    }
  }
  const encodedAction = action ? JSON.stringify(action) : null;
  const delay =
    state?.phase === "finished"
      ? 6500 + index * 600
      : state?.code.startsWith("E2E")
        ? role === "host"
          ? 500
          : 700 + index * 400
        : role === "host"
          ? 1200
          : 4500 + index * 1800;
  useEffect(() => {
    if (!encodedAction) return;
    const timer = window.setTimeout(() => send(JSON.parse(encodedAction) as ClientMessage), delay);
    return () => window.clearTimeout(timer);
  }, [encodedAction, send, delay]);
}

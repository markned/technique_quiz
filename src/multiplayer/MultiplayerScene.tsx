import { type ReactNode } from "react";
import type { PublicRoomState } from "./types";
import { roundById } from "./rounds";
import { QuizBackground } from "../components/QuizBackground";
import { multiplayerRoundBackground } from "../helpers/roundBackground";

/** The same background and content column as LocalGameApp. Phones do not play music. */
export function MultiplayerScene({ state, children }: { state: PublicRoomState; children: ReactNode }) {
  const round = state.round ?? roundById(state.currentRoundId);
  const background = multiplayerRoundBackground({ ...state, round });
  return (
    <main className="app-shell app-shell-quiz multiplayer-player-scene">
      <QuizBackground
        {...background}
        synchronizedAt={state.backgroundStartedAt}
        synchronizedPausedAt={state.pausedAt}
      />
      <div className="app-overlay">{children}</div>
    </main>
  );
}

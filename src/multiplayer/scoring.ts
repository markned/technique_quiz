import type { LeaderboardRow, PublicPlayer, QuizAnswer } from "./types";

export function buildLeaderboard(players: PublicPlayer[]): LeaderboardRow[] {
  const sorted = [...players].sort((a, b) => {
    const byScore = b.score - a.score;
    if (byScore !== 0) return byScore;
    const byName = a.name.localeCompare(b.name, "ru");
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id);
  });

  let previousScore: number | null = null;
  let previousRank = 0;
  return sorted.map((player, index) => {
    const rank = previousScore === player.score ? previousRank : index + 1;
    previousScore = player.score;
    previousRank = rank;
    return {
      rank,
      playerId: player.id,
      name: player.name,
      score: player.score,
      connected: player.connected,
    };
  });
}

export function scoreQuizAnswer(
  answer: QuizAnswer | undefined,
  correctIndex: number,
  correctOrderIds: number[],
): boolean {
  if (!answer) return false;
  if (answer.variant === "mc4") return answer.selectedIndex === correctIndex;
  return (
    answer.orderIds.length === correctOrderIds.length &&
    answer.orderIds.every((id, index) => id === correctOrderIds[index])
  );
}

export function canVoteForSubmission(
  voterPlayerId: string,
  submissionId: string,
  availableSubmissionIds: readonly string[],
): boolean {
  return submissionId !== voterPlayerId && availableSubmissionIds.includes(submissionId);
}

export type IdentityState = {
  clientId: string | null;
  hostTokensByRoom: Record<string, string>;
  playerIdsByRoom: Record<string, string>;
};

export type IdentityAction =
  | { type: "set_client_id"; clientId: string }
  | { type: "remember_host"; roomCode: string; hostToken: string }
  | { type: "remember_player"; roomCode: string; playerId: string };

export function identityReducer(state: IdentityState, action: IdentityAction): IdentityState {
  if (action.type === "set_client_id") {
    return { ...state, clientId: action.clientId };
  }
  if (action.type === "remember_host") {
    return {
      ...state,
      hostTokensByRoom: { ...state.hostTokensByRoom, [action.roomCode]: action.hostToken },
    };
  }
  return {
    ...state,
    playerIdsByRoom: { ...state.playerIdsByRoom, [action.roomCode]: action.playerId },
  };
}

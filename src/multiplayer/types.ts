import type { GameMode } from "../types";
import type { QuizUiVariant } from "../helpers/quizOptions";

export const ROOM_CODE_LENGTH = 6;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;
export const MULTIPLAYER_SESSION_LENGTH = 14;
export const MULTIPLAYER_FREESTYLE_SESSION_LENGTH = 8;
export const MULTIPLAYER_ROUND_RESULTS_MS = 6_000;
export const MULTIPLAYER_TRANSITION_MS = 2_000;
export const MULTIPLAYER_FREESTYLE_VOTE_SECONDS = 45;

export type ClientId = string;
export type HostToken = string;
export type PlayerId = string;
export type RoomCode = string;
export type MultiplayerMode = GameMode;
export type ConnectionStatus = "connected" | "disconnected";

export type MultiplayerPhase =
  | "lobby"
  | "mode_select"
  | "rules"
  | "transition"
  | "playing"
  | "quiz_answering"
  | "freestyle_submitting"
  | "freestyle_voting"
  | "round_results"
  | "finished";

export type PublicPlayer = {
  id: PlayerId;
  clientId: ClientId;
  name: string;
  score: number;
  connected: boolean;
  joinedAt: number;
  lastSeenAt: number;
};

export type QuizAnswer =
  | {
      variant: "mc4";
      selectedIndex: number;
    }
  | {
      variant: "order";
      orderIds: number[];
    };

export type PublicQuizState = {
  variant: QuizUiVariant | null;
  options: string[];
  orderLineIds: number[];
  answerLineCount: number;
  answeredPlayerIds: PlayerId[];
  correctIndex?: number;
  correctOrderIds?: number[];
};

export type PublicFreestyleState = {
  submittedPlayerIds: PlayerId[];
  votedPlayerIds: PlayerId[];
  votingOptions: Array<{
    submissionId: PlayerId;
    text: string;
    submittedAt: number;
  }>;
};

export type LeaderboardRow = {
  rank: number;
  playerId: PlayerId;
  name: string;
  score: number;
  connected: boolean;
};

export type QuizRoundResult = {
  kind: "quiz";
  correctAnswer: string;
  correctPlayerIds: PlayerId[];
  playerResults: Array<{
    playerId: PlayerId;
    name: string;
    correct: boolean;
    answerLabel: string;
  }>;
};

export type FreestyleRoundResult = {
  kind: "freestyle";
  originalAnswer: string;
  submissions: Array<{
    playerId: PlayerId;
    name: string;
    text: string;
    votes: number;
    similarity: number;
    similarityBonus: boolean;
    votingWinner: boolean;
    tieBrokenWinner: boolean;
  }>;
  winnerPlayerIds: PlayerId[];
  tieBreakNote: string | null;
};

export type PublicRoundResult = QuizRoundResult | FreestyleRoundResult;

export type PublicRoomState = {
  code: RoomCode;
  phase: MultiplayerPhase;
  mode: MultiplayerMode | null;
  minPlayers: number;
  maxPlayers: number;
  hostConnected: boolean;
  players: PublicPlayer[];
  currentRoundIndex: number;
  totalRounds: number;
  currentRoundId: number | null;
  upcomingRoundTitle: string | null;
  deadlineAt: number | null;
  transitionUntil: number | null;
  quiz: PublicQuizState | null;
  freestyle: PublicFreestyleState | null;
  roundResult: PublicRoundResult | null;
  leaderboard: LeaderboardRow[];
  createdAt: number;
  updatedAt: number;
};

export type ServerMessage =
  | {
      type: "snapshot";
      state: PublicRoomState;
      you: {
        role: "host" | "player" | "spectator";
        clientId: ClientId;
        playerId?: PlayerId;
        reconnected: boolean;
        restoring: boolean;
      };
    }
  | {
      type: "error";
      code:
        | "invalid_message"
        | "invalid_room"
        | "host_conflict"
        | "room_full"
        | "not_host"
        | "not_player"
        | "bad_phase"
        | "self_vote"
        | "unknown_submission";
      message: string;
    };

export type HostConnectionState = {
  role: "host";
  clientId: ClientId;
  hostToken: HostToken;
};

export type PlayerConnectionState = {
  role: "player";
  clientId: ClientId;
  playerId: PlayerId;
};

export type SpectatorConnectionState = {
  role: "spectator";
  clientId: ClientId;
};

export type ConnectionMeta = HostConnectionState | PlayerConnectionState | SpectatorConnectionState;

import type * as Party from "partykit/server";
import { parseClientMessage, type ClientMessage } from "../src/multiplayer/messages";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  MULTIPLAYER_FREESTYLE_VOTE_SECONDS,
  MULTIPLAYER_ROUND_RESULTS_MS,
  MULTIPLAYER_TRANSITION_MS,
  type ConnectionMeta,
  type FreestyleRoundResult,
  type HostToken,
  type PlayerId,
  type PublicFreestyleState,
  type PublicPlayer,
  type PublicQuizState,
  type PublicRoomState,
  type PublicRoundResult,
  type QuizAnswer,
  type QuizRoundResult,
  type ServerMessage,
} from "../src/multiplayer/types";
import { buildLeaderboard, canVoteForSubmission, scoreQuizAnswer } from "../src/multiplayer/scoring";
import { buildMultiplayerRoundOrder, buildQuizRoundPayload, roundById } from "../src/multiplayer/rounds";
import { compareAnswerSimilarity } from "../src/multiplayer/similarity";
import { revealAnswerText } from "../src/helpers/quizOptions";

const STORAGE_KEY = "room-state-v1";
const SIMILARITY_THRESHOLD = 0.5;

type StoredQuizState = PublicQuizState & {
  answers: Record<PlayerId, QuizAnswer>;
  correctAnswer: string;
  correctIndex: number;
  correctOrderIds: number[];
};

type StoredFreestyleState = PublicFreestyleState & {
  submissions: Record<
    PlayerId,
    {
      text: string;
      submittedAt: number;
    }
  >;
  votes: Record<PlayerId, PlayerId>;
};

type StoredRoomState = Omit<
  PublicRoomState,
  "players" | "quiz" | "freestyle" | "leaderboard" | "hostConnected"
> & {
  hostToken: HostToken | null;
  hostClientId: string | null;
  hostConnected: boolean;
  playersById: Record<PlayerId, PublicPlayer>;
  playerIdByClientId: Record<string, PlayerId>;
  roundOrderIds: number[];
  priorCorrectAnswers: string[];
  quiz: StoredQuizState | null;
  freestyle: StoredFreestyleState | null;
  nextAdvanceAt: number | null;
};

function nowMs(): number {
  return Date.now();
}

function normalizeRoomCode(roomId: string): string {
  return roomId.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "ROOM00";
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
}

function guessSecondsFor(revealLineCount: number): number {
  return revealLineCount <= 1 ? 30 : revealLineCount === 2 ? 45 : 60;
}

function orderedPlayers(state: StoredRoomState): PublicPlayer[] {
  return Object.values(state.playersById).sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
}

function activePlayers(state: StoredRoomState): PublicPlayer[] {
  return orderedPlayers(state).filter((player) => player.connected);
}

function currentRound(state: StoredRoomState) {
  return roundById(state.currentRoundId);
}

function e2eRoom(state: StoredRoomState): boolean {
  return state.code.startsWith("E2E");
}

function createInitialState(code: string): StoredRoomState {
  const ts = nowMs();
  return {
    code,
    phase: "lobby",
    mode: null,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    hostToken: null,
    hostClientId: null,
    hostConnected: false,
    playersById: {},
    playerIdByClientId: {},
    currentRoundIndex: 0,
    totalRounds: 0,
    currentRoundId: null,
    upcomingRoundTitle: null,
    deadlineAt: null,
    transitionUntil: null,
    quiz: null,
    freestyle: null,
    roundResult: null,
    roundOrderIds: [],
    priorCorrectAnswers: [],
    nextAdvanceAt: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

export default class TechniqueQuizRoom implements Party.Server {
  state: StoredRoomState;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly room: Party.Room) {
    this.state = createInitialState(normalizeRoomCode(room.id));
  }

  async onStart() {
    const stored = await this.room.storage.get<StoredRoomState>(STORAGE_KEY);
    if (stored) this.state = stored;
    this.scheduleTimer();
  }

  async onRequest() {
    return Response.json({
      ok: true,
      room: this.state.code,
      phase: this.state.phase,
      players: orderedPlayers(this.state).length,
    });
  }

  onConnect(connection: Party.Connection<ConnectionMeta>) {
    connection.setState(null);
    this.sendSnapshot(connection, "spectator", false, true);
  }

  async onMessage(raw: string | ArrayBuffer, connection: Party.Connection<ConnectionMeta>) {
    const message = parseClientMessage(raw);
    if (!message) {
      this.sendError(connection, "invalid_message", "Message payload is not valid for this room.");
      return;
    }
    await this.handleMessage(message, connection);
  }

  async onClose(connection: Party.Connection<ConnectionMeta>) {
    await this.markDisconnected(connection);
  }

  async onError(connection: Party.Connection<ConnectionMeta>) {
    await this.markDisconnected(connection);
  }

  private async handleMessage(message: ClientMessage, connection: Party.Connection<ConnectionMeta>) {
    if (message.type === "host_hello") {
      await this.handleHostHello(message.clientId, message.hostToken, connection);
      return;
    }
    if (message.type === "player_join") {
      await this.handlePlayerJoin(message.clientId, message.name, message.knownPlayerId, connection);
      return;
    }

    const meta = connection.state;
    if (!meta || meta.role === "spectator") {
      this.sendError(connection, message.type.startsWith("host_") ? "not_host" : "not_player", "Join the room first.");
      return;
    }

    if (message.type.startsWith("host_")) {
      if (meta.role !== "host") {
        this.sendError(connection, "not_host", "Only the host can perform this action.");
        return;
      }
      await this.handleHostAction(message, connection);
      return;
    }

    if (meta.role !== "player") {
      this.sendError(connection, "not_player", "Only players can perform this action.");
      return;
    }
    await this.handlePlayerAction(message, meta.playerId, connection);
  }

  private async handleHostHello(clientId: string, hostToken: HostToken, connection: Party.Connection<ConnectionMeta>) {
    if (this.state.hostToken && this.state.hostToken !== hostToken) {
      this.sendError(connection, "host_conflict", "This room already has a different host session.");
      return;
    }

    const reconnected = this.state.hostToken === hostToken && this.state.hostClientId === clientId;
    this.state.hostToken = hostToken;
    this.state.hostClientId = clientId;
    this.state.hostConnected = true;
    this.state.updatedAt = nowMs();
    connection.setState({ role: "host", clientId, hostToken });
    await this.persistAndBroadcast(connection, "host", reconnected);
  }

  private async handlePlayerJoin(
    clientId: string,
    name: string,
    knownPlayerId: PlayerId | undefined,
    connection: Party.Connection<ConnectionMeta>,
  ) {
    const existingId = this.state.playerIdByClientId[clientId] ?? knownPlayerId;
    const existing = existingId ? this.state.playersById[existingId] : undefined;
    const ts = nowMs();

    if (!existing && orderedPlayers(this.state).length >= MAX_PLAYERS) {
      this.sendError(connection, "room_full", "Room is already full.");
      return;
    }

    const playerId = existing?.id ?? id("p");
    this.state.playersById[playerId] = {
      id: playerId,
      clientId,
      name: name.trim(),
      score: existing?.score ?? 0,
      connected: true,
      joinedAt: existing?.joinedAt ?? ts,
      lastSeenAt: ts,
    };
    this.state.playerIdByClientId[clientId] = playerId;
    this.state.updatedAt = ts;
    connection.setState({ role: "player", clientId, playerId });
    await this.persistAndBroadcast(connection, "player", !!existing);
  }

  private async handleHostAction(message: ClientMessage, connection: Party.Connection<ConnectionMeta>) {
    if (message.type === "host_start_mode_select") {
      if (this.state.phase !== "lobby") {
        this.sendError(connection, "bad_phase", "Mode select can only start from the lobby.");
        return;
      }
      if (activePlayers(this.state).length < MIN_PLAYERS) {
        this.sendError(connection, "bad_phase", `At least ${MIN_PLAYERS} players are required.`);
        return;
      }
      this.state.phase = "mode_select";
      this.touch();
      await this.persistAndBroadcast();
      return;
    }

    if (message.type === "host_select_mode") {
      if (this.state.phase !== "mode_select") {
        this.sendError(connection, "bad_phase", "Select mode from the mode-select screen.");
        return;
      }
      this.state.mode = message.mode;
      this.state.phase = "rules";
      this.touch();
      await this.persistAndBroadcast();
      return;
    }

    if (message.type === "host_start_game") {
      if (this.state.phase !== "rules" || !this.state.mode) {
        this.sendError(connection, "bad_phase", "The game can only start after selecting a mode.");
        return;
      }
      await this.startGame(true);
      return;
    }

    if (message.type === "host_media_checkpoint") {
      if (this.state.phase !== "playing" || message.roundId !== this.state.currentRoundId) return;
      await this.enterAnswerPhase();
      return;
    }

    if (message.type === "host_restart_game") {
      if (!this.state.mode) {
        this.state.phase = orderedPlayers(this.state).length >= MIN_PLAYERS ? "mode_select" : "lobby";
        this.touch();
        await this.persistAndBroadcast();
        return;
      }
      await this.startGame(true);
    }
  }

  private async handlePlayerAction(
    message: ClientMessage,
    playerId: PlayerId,
    connection: Party.Connection<ConnectionMeta>,
  ) {
    const player = this.state.playersById[playerId];
    if (!player) {
      this.sendError(connection, "not_player", "Player session is not registered in this room.");
      return;
    }
    player.lastSeenAt = nowMs();

    if (message.type === "player_rename") {
      player.name = message.name.trim();
      this.touch();
      await this.persistAndBroadcast();
      return;
    }

    if (message.type === "player_quiz_answer") {
      if (this.state.phase !== "quiz_answering" || !this.state.quiz) {
        this.sendError(connection, "bad_phase", "This room is not accepting quiz answers right now.");
        return;
      }
      this.state.quiz.answers[playerId] = message.answer;
      this.state.quiz.answeredPlayerIds = Object.keys(this.state.quiz.answers);
      this.touch();
      if (this.allConnectedPlayersDone(this.state.quiz.answeredPlayerIds)) {
        await this.finalizeQuizRound();
        return;
      }
      await this.persistAndBroadcast();
      return;
    }

    if (message.type === "player_freestyle_submit") {
      if (this.state.phase !== "freestyle_submitting" || !this.state.freestyle) {
        this.sendError(connection, "bad_phase", "This room is not accepting submissions right now.");
        return;
      }
      this.state.freestyle.submissions[playerId] = {
        text: message.text.trim(),
        submittedAt: nowMs(),
      };
      this.syncFreestylePublicState();
      this.touch();
      if (this.allConnectedPlayersDone(this.state.freestyle.submittedPlayerIds)) {
        await this.enterFreestyleVoting();
        return;
      }
      await this.persistAndBroadcast();
      return;
    }

    if (message.type === "player_vote") {
      if (this.state.phase !== "freestyle_voting" || !this.state.freestyle) {
        this.sendError(connection, "bad_phase", "This room is not accepting votes right now.");
        return;
      }
      if (message.submissionId === playerId) {
        this.sendError(connection, "self_vote", "Players cannot vote for their own answer.");
        return;
      }
      if (!canVoteForSubmission(playerId, message.submissionId, Object.keys(this.state.freestyle.submissions))) {
        this.sendError(connection, "unknown_submission", "That submission does not exist.");
        return;
      }
      this.state.freestyle.votes[playerId] = message.submissionId;
      this.syncFreestylePublicState();
      this.touch();
      if (this.allEligibleVotersDone()) {
        await this.finalizeFreestyleRound();
        return;
      }
      await this.persistAndBroadcast();
    }
  }

  private async startGame(resetScores: boolean) {
    if (!this.state.mode) return;
    if (resetScores) {
      for (const player of Object.values(this.state.playersById)) {
        player.score = 0;
      }
    }
    this.state.roundOrderIds = e2eRoom(this.state)
      ? this.state.mode === "quiz"
        ? [1, 2, 9]
        : [1, 3, 4]
      : buildMultiplayerRoundOrder(this.state.mode).map((round) => round.id);
    this.state.totalRounds = this.state.roundOrderIds.length;
    this.state.currentRoundIndex = 0;
    this.state.priorCorrectAnswers = [];
    await this.enterTransition();
  }

  private async enterTransition() {
    const roundId = this.state.roundOrderIds[this.state.currentRoundIndex] ?? null;
    const round = roundById(roundId);
    if (!round) {
      await this.finishGame();
      return;
    }
    this.clearTimer();
    this.state.phase = "transition";
    this.state.currentRoundId = round.id;
    this.state.upcomingRoundTitle = round.title;
    this.state.deadlineAt = null;
    this.state.transitionUntil = nowMs() + (e2eRoom(this.state) ? 300 : MULTIPLAYER_TRANSITION_MS);
    this.state.nextAdvanceAt = null;
    this.state.roundResult = null;
    this.state.freestyle = null;
    this.state.quiz = null;
    if (this.state.mode === "quiz") {
      const payload = buildQuizRoundPayload(round, new Set(this.state.priorCorrectAnswers));
      this.state.quiz = {
        variant: payload.variant,
        options: payload.options,
        orderLineIds: payload.orderLineIds,
        answerLineCount: round.revealLineIds.length,
        answeredPlayerIds: [],
        answers: {},
        correctAnswer: payload.correctAnswer,
        correctIndex: payload.correctIndex,
        correctOrderIds: payload.correctOrderIds,
      };
    } else {
      this.state.freestyle = {
        submittedPlayerIds: [],
        votedPlayerIds: [],
        votingOptions: [],
        submissions: {},
        votes: {},
      };
    }
    this.touch();
    await this.persistAndBroadcast();
    this.scheduleTimer();
  }

  private async enterPlaying() {
    if (this.state.phase !== "transition") return;
    this.state.phase = "playing";
    this.state.transitionUntil = null;
    this.state.nextAdvanceAt = null;
    this.touch();
    await this.persistAndBroadcast();
  }

  private async enterAnswerPhase() {
    const round = currentRound(this.state);
    if (!round) return;
    this.clearTimer();
    const deadlineAt = nowMs() + (e2eRoom(this.state) ? 5 : guessSecondsFor(round.revealLineIds.length)) * 1_000;
    this.state.deadlineAt = deadlineAt;
    this.state.nextAdvanceAt = null;
    if (this.state.mode === "quiz" && this.state.quiz) {
      this.state.phase = "quiz_answering";
      this.state.quiz.answers = {};
      this.state.quiz.answeredPlayerIds = [];
    } else if (this.state.mode === "freestyle" && this.state.freestyle) {
      this.state.phase = "freestyle_submitting";
      this.state.freestyle.submissions = {};
      this.state.freestyle.votes = {};
      this.syncFreestylePublicState();
    }
    this.touch();
    await this.persistAndBroadcast();
    this.scheduleTimer();
  }

  private async enterFreestyleVoting() {
    if (!this.state.freestyle) return;
    this.clearTimer();
    this.state.phase = "freestyle_voting";
    this.state.deadlineAt = nowMs() + (e2eRoom(this.state) ? 5 : MULTIPLAYER_FREESTYLE_VOTE_SECONDS) * 1_000;
    this.syncFreestylePublicState();
    this.touch();
    if (this.state.freestyle.votingOptions.length <= 1 || this.allEligibleVotersDone()) {
      await this.finalizeFreestyleRound();
      return;
    }
    await this.persistAndBroadcast();
    this.scheduleTimer();
  }

  private async finalizeQuizRound() {
    const quiz = this.state.quiz;
    const round = currentRound(this.state);
    if (!quiz || !round) return;
    this.clearTimer();
    const playerResults: QuizRoundResult["playerResults"] = [];
    const correctPlayerIds: PlayerId[] = [];
    for (const player of orderedPlayers(this.state)) {
      const answer = quiz.answers[player.id];
      const correct = scoreQuizAnswer(answer, quiz.correctIndex, quiz.correctOrderIds);
      if (correct) {
        player.score += 1;
        correctPlayerIds.push(player.id);
      }
      playerResults.push({
        playerId: player.id,
        name: player.name,
        correct,
        answerLabel: answer ? this.answerLabel(answer, round) : "Нет ответа",
      });
    }
    this.state.priorCorrectAnswers.push(quiz.correctAnswer);
    this.state.roundResult = {
      kind: "quiz",
      correctAnswer: quiz.correctAnswer,
      correctPlayerIds,
      playerResults,
    };
    this.state.phase = "round_results";
    this.state.deadlineAt = null;
    this.state.nextAdvanceAt = nowMs() + (e2eRoom(this.state) ? 1_200 : MULTIPLAYER_ROUND_RESULTS_MS);
    quiz.correctIndex = quiz.correctIndex;
    quiz.correctOrderIds = quiz.correctOrderIds;
    this.touch();
    await this.persistAndBroadcast();
  }

  private async finalizeFreestyleRound() {
    const freestyle = this.state.freestyle;
    const round = currentRound(this.state);
    if (!freestyle || !round) return;
    this.clearTimer();

    const originalAnswer = revealAnswerText(round);
    const voteCounts = new Map<PlayerId, number>();
    for (const targetId of Object.values(freestyle.votes)) {
      voteCounts.set(targetId, (voteCounts.get(targetId) ?? 0) + 1);
    }

    const submittedIds = Object.keys(freestyle.submissions).sort((a, b) => {
      const aa = freestyle.submissions[a]!;
      const bb = freestyle.submissions[b]!;
      return aa.submittedAt - bb.submittedAt || a.localeCompare(b);
    });
    const maxVotes = submittedIds.reduce((max, playerId) => Math.max(max, voteCounts.get(playerId) ?? 0), 0);
    const tiedWinners = submittedIds.filter((playerId) => (voteCounts.get(playerId) ?? 0) === maxVotes);
    const tieBrokenWinner = tiedWinners[0] ?? null;

    if (tieBrokenWinner && submittedIds.length > 0) {
      this.state.playersById[tieBrokenWinner]!.score += 1;
    }

    const submissions: FreestyleRoundResult["submissions"] = submittedIds.map((playerId) => {
      const submission = freestyle.submissions[playerId]!;
      const similarity = compareAnswerSimilarity(submission.text, originalAnswer).score;
      const similarityBonus = similarity >= SIMILARITY_THRESHOLD;
      if (similarityBonus) this.state.playersById[playerId]!.score += 1;
      return {
        playerId,
        name: this.state.playersById[playerId]?.name ?? "Игрок",
        text: submission.text,
        votes: voteCounts.get(playerId) ?? 0,
        similarity,
        similarityBonus,
        votingWinner: tiedWinners.includes(playerId),
        tieBrokenWinner: playerId === tieBrokenWinner,
      };
    });

    const tieBreakNote =
      tiedWinners.length > 1
        ? `Ничья по голосам: победил самый ранний ответ (${this.state.playersById[tieBrokenWinner!]?.name ?? "игрок"}).`
        : null;

    this.state.roundResult = {
      kind: "freestyle",
      originalAnswer,
      submissions,
      winnerPlayerIds: tieBrokenWinner ? [tieBrokenWinner] : [],
      tieBreakNote,
    };
    this.state.phase = "round_results";
    this.state.deadlineAt = null;
    this.state.nextAdvanceAt = nowMs() + (e2eRoom(this.state) ? 1_200 : MULTIPLAYER_ROUND_RESULTS_MS);
    this.touch();
    await this.persistAndBroadcast();
  }

  private async finishGame() {
    this.clearTimer();
    this.state.phase = "finished";
    this.state.deadlineAt = null;
    this.state.transitionUntil = null;
    this.state.nextAdvanceAt = null;
    this.touch();
    await this.persistAndBroadcast();
  }

  private scheduleTimer() {
    this.clearTimer();
    const ts = nowMs();
    if (this.state.phase === "transition" && this.state.transitionUntil) {
      this.timer = setTimeout(() => void this.enterPlaying(), Math.max(0, this.state.transitionUntil - ts));
      return;
    }
    if (this.state.deadlineAt) {
      this.timer = setTimeout(() => void this.onDeadline(), Math.max(0, this.state.deadlineAt - ts));
      return;
    }
    if (this.state.phase === "round_results" && this.state.nextAdvanceAt) {
      this.timer = setTimeout(() => void this.advanceAfterResults(), Math.max(0, this.state.nextAdvanceAt - ts));
    }
  }

  private async advanceAfterResults() {
    if (this.state.phase !== "round_results") return;
    this.state.currentRoundIndex += 1;
    if (this.state.currentRoundIndex >= this.state.roundOrderIds.length) {
      await this.finishGame();
      return;
    }
    await this.enterTransition();
  }

  private async onDeadline() {
    if (this.state.phase === "quiz_answering") {
      await this.finalizeQuizRound();
      return;
    }
    if (this.state.phase === "freestyle_submitting") {
      await this.enterFreestyleVoting();
      return;
    }
    if (this.state.phase === "freestyle_voting") {
      await this.finalizeFreestyleRound();
    }
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private allConnectedPlayersDone(donePlayerIds: PlayerId[]): boolean {
    const done = new Set(donePlayerIds);
    const connected = activePlayers(this.state);
    return connected.length > 0 && connected.every((player) => done.has(player.id));
  }

  private allEligibleVotersDone(): boolean {
    const freestyle = this.state.freestyle;
    if (!freestyle) return false;
    const submissions = new Set(Object.keys(freestyle.submissions));
    const eligible = activePlayers(this.state).filter((player) =>
      [...submissions].some((submissionId) => submissionId !== player.id),
    );
    return eligible.length === 0 || eligible.every((player) => !!freestyle.votes[player.id]);
  }

  private syncFreestylePublicState() {
    const freestyle = this.state.freestyle;
    if (!freestyle) return;
    freestyle.submittedPlayerIds = Object.keys(freestyle.submissions);
    freestyle.votedPlayerIds = Object.keys(freestyle.votes);
    freestyle.votingOptions =
      this.state.phase === "freestyle_voting" || this.state.phase === "round_results" || this.state.phase === "finished"
        ? Object.entries(freestyle.submissions)
            .map(([submissionId, submission]) => ({
              submissionId,
              text: submission.text,
              submittedAt: submission.submittedAt,
            }))
            .sort((a, b) => a.submittedAt - b.submittedAt || a.submissionId.localeCompare(b.submissionId))
        : [];
  }

  private answerLabel(answer: QuizAnswer, round: NonNullable<ReturnType<typeof currentRound>>): string {
    if (answer.variant === "mc4") {
      return this.state.quiz?.options[answer.selectedIndex] ?? `Вариант ${answer.selectedIndex + 1}`;
    }
    return answer.orderIds.map((lineId) => round.lyrics.find((line) => line.id === lineId)?.text ?? "—").join(" / ");
  }

  private publicState(): PublicRoomState {
    const players = orderedPlayers(this.state);
    const showCorrect = this.state.phase === "round_results" || this.state.phase === "finished";
    return {
      code: this.state.code,
      phase: this.state.phase,
      mode: this.state.mode,
      minPlayers: this.state.minPlayers,
      maxPlayers: this.state.maxPlayers,
      hostConnected: this.state.hostConnected,
      players,
      currentRoundIndex: this.state.currentRoundIndex,
      totalRounds: this.state.totalRounds,
      currentRoundId: this.state.currentRoundId,
      upcomingRoundTitle: this.state.upcomingRoundTitle,
      deadlineAt: this.state.deadlineAt,
      transitionUntil: this.state.transitionUntil,
      nextAdvanceAt: this.state.nextAdvanceAt,
      quiz: this.state.quiz
        ? {
            variant: this.state.quiz.variant,
            options: this.state.quiz.options,
            orderLineIds: this.state.quiz.orderLineIds,
            answerLineCount: this.state.quiz.answerLineCount,
            answeredPlayerIds: this.state.quiz.answeredPlayerIds,
            correctIndex: showCorrect ? this.state.quiz.correctIndex : undefined,
            correctOrderIds: showCorrect ? this.state.quiz.correctOrderIds : undefined,
          }
        : null,
      freestyle: this.state.freestyle
        ? {
            submittedPlayerIds: this.state.freestyle.submittedPlayerIds,
            votedPlayerIds: this.state.freestyle.votedPlayerIds,
            votingOptions: this.state.freestyle.votingOptions,
          }
        : null,
      roundResult: this.state.roundResult as PublicRoundResult | null,
      leaderboard: buildLeaderboard(players),
      createdAt: this.state.createdAt,
      updatedAt: this.state.updatedAt,
    };
  }

  private async markDisconnected(connection: Party.Connection<ConnectionMeta>) {
    const meta = connection.state;
    if (!meta) return;
    if (meta.role === "host") {
      this.state.hostConnected = false;
    }
    if (meta.role === "player") {
      const player = this.state.playersById[meta.playerId];
      if (player) {
        player.connected = false;
        player.lastSeenAt = nowMs();
      }
    }
    this.touch();
    await this.persistAndBroadcast();
  }

  private touch() {
    this.state.updatedAt = nowMs();
  }

  private async persistAndBroadcast(
    directConnection?: Party.Connection<ConnectionMeta>,
    directRole?: "host" | "player" | "spectator",
    directReconnected = false,
  ) {
    await this.room.storage.put(STORAGE_KEY, this.state);
    for (const connection of this.room.getConnections<ConnectionMeta>()) {
      if (directConnection && connection.id === directConnection.id && directRole) {
        this.sendSnapshot(connection, directRole, directReconnected, false);
      } else {
        const role = connection.state?.role ?? "spectator";
        this.sendSnapshot(connection, role, false, false);
      }
    }
    this.scheduleTimer();
  }

  private sendSnapshot(
    connection: Party.Connection<ConnectionMeta>,
    role: "host" | "player" | "spectator",
    reconnected: boolean,
    restoring: boolean,
  ) {
    const meta = connection.state;
    const message: ServerMessage = {
      type: "snapshot",
      state: this.publicState(),
      you: {
        role,
        clientId: meta?.clientId ?? "pending",
        playerId: meta?.role === "player" ? meta.playerId : undefined,
        reconnected,
        restoring,
      },
    };
    connection.send(JSON.stringify(message));
  }

  private sendError(connection: Party.Connection<ConnectionMeta>, code: Extract<ServerMessage, { type: "error" }>["code"], message: string) {
    connection.send(JSON.stringify({ type: "error", code, message } satisfies ServerMessage));
  }
}

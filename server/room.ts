export interface RoomConnection {
  id: string;
  state: ConnectionMeta | null;
  setState(state: ConnectionMeta | null): unknown;
  send(message: string): void;
}

export interface RoomRuntime {
  id: string;
  testMode: boolean;
  publishedRounds?(): Promise<Round[]>;
  load(): Promise<StoredRoomState | undefined>;
  save(state: StoredRoomState, alarmAt: number): Promise<void>;
  connections(): Iterable<RoomConnection>;
}
import type { Round } from "../src/types";
import { rounds as seedRounds } from "../src/content/rounds";
import { parseClientMessage, type ClientMessage } from "../src/multiplayer/messages";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  minimumPlayersForMode,
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
import { compareAnswerSimilarity, FREESTYLE_SIMILARITY_THRESHOLD } from "../src/multiplayer/similarity";
import { revealAnswerText } from "../src/helpers/quizOptions";

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

export type StoredRoomState = Omit<
  PublicRoomState,
  "players" | "quiz" | "freestyle" | "leaderboard" | "hostConnected"
> & {
  hostToken: HostToken | null;
  hostClientId: string | null;
  hostConnected: boolean;
  playersById: Record<PlayerId, PublicPlayer & { clientId: string }>;
  playerTokens: Record<PlayerId, string>;
  roundSnapshots: Round[];
  quizPayloads: Record<number, ReturnType<typeof buildQuizRoundPayload>>;
  pausedAt: number | null;
  expiresAt: number;
  discord: boolean;
  turnId: string;
  playingStartedAt: number | null;
  activeHostConnectionId: string | null;
  hostLastSeenAt: number | null;
  playerIdByClientId: Record<string, PlayerId>;
  roundOrderIds: number[];
  priorCorrectAnswers: string[];
  onlineReservations?: Record<string, { token: string; expiresAt: number }>;
  onlineReplays?: Record<PlayerId, { id: string; startedAt: number; endsAt: number }>;
  onlineSubmissionIds?: Record<PlayerId, string>;
  quiz: StoredQuizState | null;
  freestyle: StoredFreestyleState | null;
  nextAdvanceAt: number | null;
};

function nowMs(): number {
  return Date.now();
}

function normalizeRoomCode(roomId: string): string {
  return (
    roomId
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6) || "ROOM00"
  );
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
}

function guessSecondsFor(revealLineCount: number): number {
  return revealLineCount <= 1 ? 30 : revealLineCount === 2 ? 45 : 60;
}

function orderedPlayers(state: StoredRoomState): Array<StoredRoomState["playersById"][string]> {
  return Object.values(state.playersById).sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
}

function activePlayers(state: StoredRoomState): Array<StoredRoomState["playersById"][string]> {
  return orderedPlayers(state).filter((player) => player.connected);
}

function currentRound(state: StoredRoomState) {
  return (
    state.roundSnapshots.find((round) => round.id === state.currentRoundId) ?? roundById(state.currentRoundId)
  );
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
    playerTokens: {},
    roundSnapshots: [],
    quizPayloads: {},
    pausedAt: null,
    manualPaused: false,
    replay: null,
    expiresAt: ts + 30 * 60_000,
    discord: false,
    turnId: "",
    playingStartedAt: null,
    backgroundStartedAt: null,
    answerSeconds: 30,
    voteSeconds: 45,
    finalVote: null,
    initialVote: null,
    rosterLocked: false,
    activeHostConnectionId: null,
    hostLastSeenAt: null,
    playerIdByClientId: {},
    currentRoundIndex: 0,
    totalRounds: 0,
    currentRoundId: null,
    round: null,
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

export class QuizRoom {
  state: StoredRoomState;

  constructor(readonly room: RoomRuntime) {
    this.state = createInitialState(normalizeRoomCode(room.id));
  }

  async onStart() {
    const stored = await this.room.load();
    if (stored) this.state = stored;
    this.state.manualPaused ??= false;
    this.state.replay ??= null;
    this.state.minPlayers = MIN_PLAYERS;
    this.state.discord = false;
    this.state.finalVote ??= this.state.phase === "finished" ? { votes: {}, decision: null } : null;
    this.state.backgroundStartedAt ??= this.state.playingStartedAt;
    this.state.initialVote ??= this.state.phase === "mode_select" ? { votes: {}, decision: null } : null;
    this.state.rosterLocked ??= !["lobby", "mode_select", "finished"].includes(this.state.phase);
    // Socket attachments survive hibernation; derive presence from live connections.
    const connections = [...this.room.connections()];
    this.state.hostConnected = connections.some(
      (c) => c.state?.role === "host" && c.id === this.state.activeHostConnectionId,
    );
    for (const player of Object.values(this.state.playersById)) {
      player.connected = connections.some(
        (c) => c.state?.role === "player" && c.state.playerId === player.id,
      );
    }
    if (!this.state.online && !this.state.hostConnected && this.isActive() && !this.state.pausedAt)
      this.state.pausedAt = nowMs();
    await this.advanceDue();
    await this.save();
  }

  async onRequest() {
    return Response.json({
      ok: true,
      room: this.state.code,
      phase: this.state.phase,
      players: orderedPlayers(this.state).length,
    });
  }

  onConnect(connection: RoomConnection) {
    connection.setState(null);
    this.sendSnapshot(connection, "spectator", false, true);
  }

  async onMessage(raw: string | ArrayBuffer, connection: RoomConnection) {
    const message = parseClientMessage(raw);
    if (!message) {
      this.sendError(connection, "invalid_message", "Message payload is not valid for this room.");
      return;
    }
    await this.advanceDue();
    await this.handleMessage(message, connection);
  }

  async onClose(connection: RoomConnection) {
    await this.markDisconnected(connection);
  }

  async onError(connection: RoomConnection) {
    await this.markDisconnected(connection);
  }

  private async handleMessage(message: ClientMessage, connection: RoomConnection) {
    if (this.state.phase === "expired") {
      this.sendError(connection, "room_expired", "Комната закрыта. Создай новую комнату.");
      return;
    }
    if (message.type === "host_hello") {
      if (this.state.online) {
        this.sendError(connection, "not_host", "В онлайн-матче нет ведущего.");
        return;
      }
      await this.handleHostHello(message.clientId, message.hostToken, connection);
      return;
    }
    if (message.type === "player_join") {
      await this.handlePlayerJoin(
        message.clientId,
        message.name,
        message.knownPlayerId,
        message.playerToken,
        connection,
      );
      return;
    }

    const meta = connection.state;
    if (!meta || meta.role === "spectator") {
      this.sendError(
        connection,
        message.type.startsWith("host_") ? "not_host" : "not_player",
        "Join the room first.",
      );
      return;
    }

    if (
      message.type === "host_pause" &&
      meta.role === "host" &&
      connection.id === this.state.activeHostConnectionId
    ) {
      if (!this.isActive()) return;
      if (message.paused) {
        this.state.manualPaused = true;
        this.state.pausedAt ??= nowMs();
      } else {
        this.state.manualPaused = false;
        this.resumeClock();
        if (
          this.state.phase === "quiz_answering" &&
          this.state.quiz &&
          this.allConnectedPlayersDone(this.state.quiz.answeredPlayerIds)
        ) {
          await this.finalizeQuizRound();
          return;
        }
        if (
          this.state.phase === "freestyle_submitting" &&
          this.state.freestyle &&
          this.allConnectedPlayersDone(this.state.freestyle.submittedPlayerIds)
        ) {
          await this.enterFreestyleVoting();
          return;
        }
        if (this.state.phase === "freestyle_voting" && this.allEligibleVotersDone()) {
          await this.finalizeFreestyleRound();
          return;
        }
      }
      this.touch(false);
      await this.persistAndBroadcast();
      return;
    }
    if (message.type === "player_leave" && meta.role === "player") {
      await this.handlePlayerAction(message, meta.playerId, connection);
      return;
    }
    if (message.type === "ping") {
      if (this.state.online && meta.role === "player") {
        const player = this.state.playersById[meta.playerId];
        if (player) {
          player.lastSeenAt = nowMs();
          player.connected = true;
          await this.save();
        }
      }
      if (meta.role === "host" && connection.id === this.state.activeHostConnectionId) {
        if (!this.state.hostConnected) {
          await this.handleHostHello(meta.clientId, meta.hostToken, connection);
          return;
        }
        this.state.hostLastSeenAt = nowMs();
        this.touch(!this.state.pausedAt);
        await this.save();
      }
      this.sendSnapshot(connection, meta.role, false, false);
      return;
    }
    if (
      message.type === "host_retry_media" &&
      meta.role === "host" &&
      connection.id === this.state.activeHostConnectionId &&
      (this.state.phase === "playing" || !!this.state.replay)
    ) {
      if (this.state.manualPaused) return;
      this.resumeClock();
      if (this.state.replay) {
        this.state.replay.startedAt = null;
        this.state.replay.endsAt = null;
      } else this.state.playingStartedAt = null;
      this.state.nextAdvanceAt = nowMs() + 30_000;
      this.touch();
      await this.persistAndBroadcast();
      return;
    }
    if (this.state.pausedAt) {
      this.sendError(connection, "bad_phase", "Игра приостановлена: ждём главный экран.");
      return;
    }
    if ("turnId" in message && message.turnId !== this.state.turnId) {
      this.sendError(connection, "bad_phase", "Этот раунд уже завершён.");
      return;
    }
    if (message.type.startsWith("host_")) {
      if (meta.role !== "host" || connection.id !== this.state.activeHostConnectionId) {
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

  private resumeClock() {
    if (this.state.pausedAt === null) return;
    const elapsed = Math.max(0, nowMs() - this.state.pausedAt);
    for (const key of [
      "deadlineAt",
      "transitionUntil",
      "nextAdvanceAt",
      "playingStartedAt",
      "backgroundStartedAt",
    ] as const) {
      const value = this.state[key];
      if (value !== null) this.state[key] = value + elapsed;
    }
    if (this.state.replay) {
      if (this.state.replay.startedAt !== null) this.state.replay.startedAt += elapsed;
      if (this.state.replay.endsAt !== null) this.state.replay.endsAt += elapsed;
    }
    this.state.pausedAt = null;
  }

  private async handleHostHello(clientId: string, hostToken: HostToken, connection: RoomConnection) {
    if (this.state.hostToken && this.state.hostToken !== hostToken) {
      this.sendError(connection, "host_conflict", "This room already has a different host session.");
      return;
    }

    const reconnected = this.state.hostToken === hostToken && this.state.hostClientId === clientId;
    for (const other of this.room.connections()) {
      if (other.id !== connection.id && other.state?.role === "host") {
        other.setState({ role: "spectator", clientId: other.state.clientId });
        this.sendError(other, "session_replaced", "Главный экран открыт на другом устройстве.");
      }
    }
    if (!this.state.manualPaused) this.resumeClock();
    this.state.hostLastSeenAt = nowMs();
    this.state.activeHostConnectionId = connection.id;
    this.state.hostToken = hostToken;
    this.state.hostClientId = clientId;
    this.state.hostConnected = true;
    this.state.updatedAt = nowMs();
    connection.setState({ role: "host", clientId, hostToken });
    this.resolveFinalVotes();
    await this.persistAndBroadcast(connection, "host", reconnected);
  }

  private async handlePlayerJoin(
    clientId: string,
    name: string,
    knownPlayerId: PlayerId | undefined,
    playerToken: string,
    connection: RoomConnection,
  ) {
    if (!this.state.hostToken && !this.state.online) {
      this.sendError(connection, "invalid_room", "Комната не найдена. Проверь код.");
      return;
    }
    const candidate = this.state.playerIdByClientId[clientId] ?? knownPlayerId;
    const existingId =
      candidate && this.state.playerTokens[candidate] === playerToken ? candidate : undefined;
    const existing = existingId ? this.state.playersById[existingId] : undefined;
    const ts = nowMs();
    if (this.state.online) {
      const reservation = this.state.onlineReservations?.[clientId];
      if (!reservation || reservation.token !== playerToken || (!existing && reservation.expiresAt < ts)) {
        this.sendError(connection, "invalid_room", "Войди в онлайн-матч через поиск.");
        return;
      }
    }

    if (
      !existing &&
      (this.state.rosterLocked || !["lobby", "mode_select", "finished"].includes(this.state.phase))
    ) {
      if (this.state.online) {
        connection.send(JSON.stringify({ type: "player_left" } satisfies ServerMessage));
        return;
      }
      this.sendError(connection, "bad_phase", "Состав уже определён. Дождись завершения игры.");
      return;
    }
    if (!existing && orderedPlayers(this.state).length >= this.state.maxPlayers) {
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
    this.state.playerTokens[playerId] = playerToken;
    this.state.updatedAt = ts;
    connection.setState({ role: "player", clientId, playerId });
    if (this.state.online) {
      this.updateOnlineLobby();
      if (activePlayers(this.state).length >= minimumPlayersForMode(this.state.mode))
        this.state.online.quorumDeadlineAt = null;
    }
    this.resolveFinalVotes();
    await this.persistAndBroadcast(connection, "player", !!existing);
  }

  /** Called only through the internal Durable Object binding, never a client message. */
  async reserveOnline(clientId: string, token: string): Promise<boolean> {
    await this.advanceDue();
    if (!this.state.online) {
      if (this.state.hostToken || Object.keys(this.state.playersById).length || this.state.phase !== "lobby")
        return false;
      this.state.online = {
        readyPlayerIds: [],
        readyDeadlineAt: null,
        modeVoteDeadlineAt: null,
        mediaReadyPlayerIds: [],
        mediaLoadDeadlineAt: null,
        eligiblePlayerIds: [],
        quorumDeadlineAt: null,
        endedEarly: false,
        rematchPlayerIds: [],
        rematchDeadlineAt: null,
      };
      this.state.onlineReservations = {};
      this.state.onlineReplays = {};
      this.state.maxPlayers = 6;
    }
    const reservations = this.state.onlineReservations!;
    const prior = reservations[clientId];
    if (prior) {
      if (prior.token !== token || this.state.phase === "expired") return false;
      if (this.state.playerIdByClientId[clientId]) return true;
      if (this.state.phase !== "lobby") return false;
      prior.expiresAt = nowMs() + 30000;
      await this.save();
      return true;
    }
    if (this.state.phase !== "lobby" || this.state.rosterLocked) return false;
    for (const [client, lease] of Object.entries(reservations)) {
      if (lease.expiresAt < nowMs() && !this.state.playerIdByClientId[client]) delete reservations[client];
    }
    if (Object.keys(reservations).length >= 6) return false;
    reservations[clientId] = { token, expiresAt: nowMs() + 30_000 };
    this.touch();
    await this.save();
    return true;
  }

  async releaseOnline(clientId: string, token: string) {
    if (!this.state.online || this.state.onlineReservations?.[clientId]?.token !== token) return;
    delete this.state.onlineReservations[clientId];
    const playerId = this.state.playerIdByClientId[clientId];
    if (playerId) {
      const player = this.state.playersById[playerId];
      if (player) player.connected = false;
      if (this.isActive() && activePlayers(this.state).length < minimumPlayersForMode(this.state.mode))
        this.state.online.quorumDeadlineAt ??= nowMs() + 30000;
      delete this.state.playerTokens[playerId];
      this.state.online.readyPlayerIds = this.state.online.readyPlayerIds.filter((id) => id !== playerId);
      if (this.state.phase === "lobby") {
        delete this.state.playersById[playerId];
        delete this.state.playerIdByClientId[clientId];
      }
      for (const socket of this.room.connections()) {
        if (socket.state?.role === "player" && socket.state.playerId === playerId) {
          socket.setState({ role: "spectator", clientId });
          socket.send(JSON.stringify({ type: "player_left" } satisfies ServerMessage));
        }
      }
    }
    this.updateOnlineLobby();
    if (this.state.phase === "mode_select" && activePlayers(this.state).length < 2)
      this.state.nextAdvanceAt = nowMs();
    this.touch(false);
    await this.persistAndBroadcast();
  }

  private updateOnlineLobby() {
    const online = this.state.online!;
    if (this.state.phase !== "lobby") return;
    const players = activePlayers(this.state);
    online.readyPlayerIds = online.readyPlayerIds.filter((id) => players.some((p) => p.id === id));
    if (players.length < 2) {
      online.readyDeadlineAt = null;
      return;
    }
    online.readyDeadlineAt ??= nowMs() + 15000;
    if (!players.every((p) => online.readyPlayerIds.includes(p.id))) return;
    this.state.phase = "mode_select";
    this.state.mode = null;
    this.state.rosterLocked = true;
    online.readyDeadlineAt = null;
    online.modeVoteDeadlineAt = nowMs() + (this.isTest() ? 3000 : 15000);
    this.state.initialVote = { votes: {}, decision: null };
    this.resolveOnlineMode();
  }

  private resolveOnlineMode() {
    const online = this.state.online!;
    const vote = this.state.initialVote;
    if (this.state.phase !== "mode_select" || !vote) return;
    const players = activePlayers(this.state);
    if (players.length < 2) {
      this.state.nextAdvanceAt = nowMs();
      return;
    }
    if (vote.decision) {
      if (players.length < minimumPlayersForMode(vote.decision.mode)) {
        vote.decision = { mode: "quiz", random: false, startsAt: nowMs() + (this.isTest() ? 300 : 1000) };
        this.state.nextAdvanceAt = vote.decision.startsAt;
      }
      return;
    }
    const votes = players.map((p) => vote.votes[p.id]);
    const quiz = votes.filter((v) => v === "quiz").length;
    const freestyle = players.length >= 3 ? votes.filter((v) => v === "freestyle").length : 0;
    const expired = online.modeVoteDeadlineAt !== null && online.modeVoteDeadlineAt <= nowMs();
    if (
      players.length > 2 &&
      !expired &&
      Math.max(quiz, freestyle) <= players.length / 2 &&
      quiz + freestyle < players.length
    )
      return;
    const tied = players.length >= 3 && quiz === freestyle && quiz > 0;
    const mode =
      players.length < 3 || quiz + freestyle === 0
        ? "quiz"
        : tied
          ? crypto.getRandomValues(new Uint8Array(1))[0]! % 2
            ? "quiz"
            : "freestyle"
          : quiz > freestyle
            ? "quiz"
            : "freestyle";
    vote.decision = { mode, random: tied, startsAt: nowMs() + (this.isTest() ? 300 : 1000) };
    this.state.nextAdvanceAt = vote.decision.startsAt;
    online.modeVoteDeadlineAt = null;
  }

  private async handleOnlineAction(
    message: ClientMessage,
    playerId: PlayerId,
    connection: RoomConnection,
  ): Promise<boolean> {
    const online = this.state.online!;
    if (message.type === "player_leave") {
      const player = this.state.playersById[playerId]!;
      await this.releaseOnline(
        player.clientId,
        this.state.onlineReservations?.[player.clientId]?.token ?? "",
      );
      return true;
    }
    if (message.type === "player_ready") {
      if (this.state.phase !== "lobby") return true;
      if (!online.readyPlayerIds.includes(playerId)) online.readyPlayerIds.push(playerId);
      this.updateOnlineLobby();
    } else if (message.type === "player_rematch") {
      if (this.state.phase !== "finished") return true;
      if (!online.rematchPlayerIds.includes(playerId)) online.rematchPlayerIds.push(playerId);
      online.rematchDeadlineAt ??= nowMs() + (this.isTest() ? 3000 : 15000);
      await this.maybeOnlineRematch();
    } else if (message.type === "player_media_ready") {
      if (this.state.phase !== "transition" || message.turnId !== this.state.turnId) return true;
      if (!online.mediaReadyPlayerIds.includes(playerId)) online.mediaReadyPlayerIds.push(playerId);
      await this.advanceOnlineDue();
    } else if (message.type === "player_media_failed") {
      if (message.turnId !== this.state.turnId) return true;
      online.mediaReadyPlayerIds = online.mediaReadyPlayerIds.filter((id) => id !== playerId);
      online.eligiblePlayerIds = online.eligiblePlayerIds.filter((id) => id !== playerId);
    } else if (message.type === "player_replay") {
      const eligible =
        online.eligiblePlayerIds.includes(playerId) &&
        (this.state.phase === "quiz_answering"
          ? !this.state.quiz?.answers[playerId]
          : this.state.phase === "freestyle_submitting" && !this.state.freestyle?.submissions[playerId]);
      if (
        message.turnId !== this.state.turnId ||
        !eligible ||
        (this.state.onlineReplays?.[playerId]?.endsAt ?? 0) > nowMs()
      )
        return true;
      const round = currentRound(this.state);
      if (!round) return true;
      const duration = Math.max(0.1, round.end - round.start - 0.12) * 1000;
      (this.state.onlineReplays ??= {})[playerId] = {
        id: id("personal"),
        startedAt: nowMs(),
        endsAt: nowMs() + duration,
      };
    } else {
      if (
        ["player_quiz_answer", "player_freestyle_submit", "player_vote"].includes(message.type) &&
        !online.eligiblePlayerIds.includes(playerId)
      ) {
        this.sendError(connection, "bad_phase", "Этот раунд пропущен: фрагмент не загрузился.");
        return true;
      }
      if (message.type === "player_vote") {
        const target = Object.entries(this.state.onlineSubmissionIds ?? {}).find(
          ([, alias]) => alias === message.submissionId,
        )?.[0];
        if (!target) {
          this.sendError(connection, "unknown_submission", "Такого ответа нет.");
          return true;
        }
        message.submissionId = target;
      }
      return false;
    }
    this.touch();
    await this.persistAndBroadcast();
    return true;
  }

  private async maybeOnlineRematch() {
    const online = this.state.online!;
    const players = activePlayers(this.state);
    const selected = players.filter((p) => online.rematchPlayerIds.includes(p.id));
    const expired = online.rematchDeadlineAt !== null && online.rematchDeadlineAt <= nowMs();
    if (!expired && (selected.length < 2 || selected.length !== players.length)) return;
    if (expired && selected.length < 2) {
      online.rematchDeadlineAt = null;
      online.rematchPlayerIds = [];
      for (const player of orderedPlayers(this.state))
        await this.releaseOnline(
          player.clientId,
          this.state.onlineReservations?.[player.clientId]?.token ?? "",
        );
      return;
    }
    for (const player of orderedPlayers(this.state)) {
      if (selected.some((p) => p.id === player.id)) continue;
      await this.releaseOnline(
        player.clientId,
        this.state.onlineReservations?.[player.clientId]?.token ?? "",
      );
      delete this.state.playersById[player.id];
      delete this.state.playerIdByClientId[player.clientId];
    }
    online.rematchDeadlineAt = null;
    online.rematchPlayerIds = [];
    this.state.phase = "lobby";
    this.state.mode = null;
    this.state.rosterLocked = false;
    this.state.finalVote = null;
    this.state.initialVote = null;
    this.state.roundResult = null;
    this.state.totalRounds = 0;
    this.state.currentRoundId = null;
    online.readyPlayerIds = selected.map((p) => p.id);
    this.updateOnlineLobby();
  }

  private nextOnlineAlarmAt(): number {
    const online = this.state.online!;
    const times = [
      this.state.expiresAt,
      online.readyDeadlineAt,
      online.modeVoteDeadlineAt,
      online.mediaLoadDeadlineAt,
      online.quorumDeadlineAt,
      online.rematchDeadlineAt,
      this.state.transitionUntil !== null && this.state.transitionUntil > nowMs()
        ? this.state.transitionUntil
        : null,
      this.state.deadlineAt,
      this.state.nextAdvanceAt,
      ...activePlayers(this.state).map((p) => p.lastSeenAt + 30000),
    ].filter((t): t is number => t !== null);
    return Math.max(nowMs() + 1, Math.min(...times));
  }

  private async advanceOnlineDue() {
    const online = this.state.online!;
    if (this.state.phase === "expired") return;
    let changed = false;
    for (const player of activePlayers(this.state)) {
      if (player.lastSeenAt + 30000 <= nowMs()) {
        player.connected = false;
        changed = true;
      }
    }
    if (nowMs() >= this.state.expiresAt) {
      this.state.phase = "expired";
      this.state.onlineReservations = {};
      this.state.playerTokens = {};
      this.state.deadlineAt = this.state.transitionUntil = this.state.nextAdvanceAt = null;
      online.readyDeadlineAt =
        online.modeVoteDeadlineAt =
        online.mediaLoadDeadlineAt =
        online.quorumDeadlineAt =
        online.rematchDeadlineAt =
          null;
      await this.persistAndBroadcast();
      return;
    }
    if (this.isActive()) {
      if (activePlayers(this.state).length < minimumPlayersForMode(this.state.mode))
        online.quorumDeadlineAt ??= nowMs() + 30000;
      else online.quorumDeadlineAt = null;
      if (online.quorumDeadlineAt !== null && online.quorumDeadlineAt <= nowMs()) {
        online.endedEarly = true;
        online.quorumDeadlineAt = null;
        online.mediaLoadDeadlineAt = null;
        await this.finishGame();
        return;
      }
    } else online.quorumDeadlineAt = null;
    if (this.state.phase === "lobby") {
      for (const player of orderedPlayers(this.state)) {
        if (!player.connected && player.lastSeenAt + 30000 <= nowMs())
          await this.releaseOnline(
            player.clientId,
            this.state.onlineReservations?.[player.clientId]?.token ?? "",
          );
      }
      if (online.readyDeadlineAt !== null && online.readyDeadlineAt <= nowMs()) {
        const ready = activePlayers(this.state).filter((p) => online.readyPlayerIds.includes(p.id));
        const keep = ready.length >= 2 ? new Set(ready.map((p) => p.id)) : new Set<string>();
        for (const player of orderedPlayers(this.state)) {
          if (!keep.has(player.id))
            await this.releaseOnline(
              player.clientId,
              this.state.onlineReservations?.[player.clientId]?.token ?? "",
            );
        }
        online.readyDeadlineAt = null;
      }
      this.updateOnlineLobby();
      changed = true;
    }
    if (this.state.phase === "mode_select") {
      if (activePlayers(this.state).length < 2) {
        this.state.phase = "lobby";
        for (const player of orderedPlayers(this.state))
          await this.releaseOnline(
            player.clientId,
            this.state.onlineReservations?.[player.clientId]?.token ?? "",
          );
        this.state.rosterLocked = false;
        this.state.initialVote = null;
        this.state.nextAdvanceAt = null;
        online.modeVoteDeadlineAt = null;
        await this.persistAndBroadcast();
        return;
      }
      this.resolveOnlineMode();
      if (this.state.initialVote?.decision && this.state.nextAdvanceAt! <= nowMs()) {
        this.state.mode = this.state.initialVote.decision.mode;
        this.state.nextAdvanceAt = null;
        await this.startGame(true);
        return;
      }
      changed = true;
    }
    if (this.state.phase === "finished" && online.rematchDeadlineAt !== null) {
      await this.maybeOnlineRematch();
      changed = true;
    }
    if (this.state.phase === "transition") {
      const players = activePlayers(this.state);
      const loaded = players.filter((p) => online.mediaReadyPlayerIds.includes(p.id));
      const expired = online.mediaLoadDeadlineAt !== null && online.mediaLoadDeadlineAt <= nowMs();
      if (
        (expired || (loaded.length === players.length && loaded.length > 0)) &&
        this.state.transitionUntil! <= nowMs()
      ) {
        online.eligiblePlayerIds = loaded.map((p) => p.id);
        online.mediaLoadDeadlineAt = null;
        this.state.transitionUntil = null;
        if (!loaded.length) {
          online.endedEarly = true;
          await this.finishGame();
          return;
        }
        this.state.phase = "playing";
        this.state.playingStartedAt = nowMs() + (this.isTest() ? 100 : 1000);
        const round = currentRound(this.state)!;
        this.state.nextAdvanceAt =
          this.state.playingStartedAt +
          (this.isTest() ? 250 : Math.max(0.1, round.end - round.start - 0.12) * 1000);
        changed = true;
      }
    } else if (this.state.phase === "playing" && this.state.nextAdvanceAt! <= nowMs()) {
      await this.enterAnswerPhase();
      return;
    } else if (this.state.phase === "round_results" && this.state.nextAdvanceAt! <= nowMs()) {
      await this.advanceAfterResults();
      return;
    } else if (this.state.deadlineAt !== null && this.state.deadlineAt <= nowMs()) {
      await this.onDeadline();
      return;
    }
    if (changed) {
      this.touch(false);
      await this.persistAndBroadcast();
    }
  }

  private async handleHostAction(message: ClientMessage, connection: RoomConnection) {
    if (message.type === "host_media_failed") {
      if (this.state.phase !== "playing" && !this.state.replay) return;
      this.state.pausedAt = nowMs();
      this.state.expiresAt = nowMs() + 30 * 60_000;
      this.touch(false);
      await this.persistAndBroadcast();
      return;
    }
    if (message.type === "host_set_discord") {
      if (this.state.phase !== "lobby") return;
      this.state.discord = false;
      this.touch();
      await this.persistAndBroadcast();
      return;
    }
    if (message.type === "host_return_lobby") {
      if (!["rules", "mode_select"].includes(this.state.phase)) return;
      this.state.phase = "lobby";
      this.state.mode = null;
      this.state.initialVote = null;
      this.state.rosterLocked = false;
      this.state.nextAdvanceAt = null;
      this.touch();
      await this.persistAndBroadcast();
      return;
    }
    if (message.type === "host_media_ready") {
      if (this.state.replay) {
        const replay = this.state.replay;
        if (message.replayId !== replay.id || replay.startedAt !== null) return;
        const round = currentRound(this.state);
        if (!round) return;
        replay.startedAt = nowMs();
        replay.endsAt =
          nowMs() + (this.isTest() ? 2_000 : Math.max(0.1, round.end - round.start - 0.12) * 1000);
        this.state.nextAdvanceAt = replay.endsAt;
        this.touch();
        await this.persistAndBroadcast();
        return;
      }
      if (message.replayId) return;
      if (this.state.phase !== "playing" || this.state.playingStartedAt !== null) return;
      const round = currentRound(this.state);
      if (!round) return;
      this.state.playingStartedAt = nowMs();
      this.state.nextAdvanceAt =
        nowMs() + (this.isTest() ? 250 : Math.max(0.1, round.end - round.start - 0.12) * 1000);
      this.touch();
      await this.persistAndBroadcast();
      return;
    }
    if (message.type === "host_start_mode_select") {
      if (this.state.phase !== "lobby") {
        this.sendError(connection, "bad_phase", "Mode select can only start from the lobby.");
        return;
      }
      if (activePlayers(this.state).length < MIN_PLAYERS) {
        this.sendError(connection, "bad_phase", `At least ${MIN_PLAYERS} players are required.`);
        return;
      }
      this.state.mode = null;
      this.state.initialVote = { votes: {}, decision: null };
      this.state.phase = "mode_select";
      this.resolveFinalVotes();
      this.touch();
      await this.persistAndBroadcast();
      return;
    }

    if (message.type === "host_select_mode" || message.type === "host_restart_game") {
      this.sendError(connection, "bad_phase", "Режим выбирают игроки голосованием.");
      return;
    }

    if (message.type === "host_start_game") {
      if (this.state.phase !== "rules" || !this.state.mode) {
        this.sendError(connection, "bad_phase", "The game can only start after selecting a mode.");
        return;
      }
      if (activePlayers(this.state).length < minimumPlayersForMode(this.state.mode)) {
        this.sendError(
          connection,
          "bad_phase",
          `Для этого режима нужны минимум ${minimumPlayersForMode(this.state.mode)} игрока.`,
        );
        return;
      }
      await this.startGame(true);
      return;
    }

    if (message.type === "host_media_checkpoint") {
      if (this.state.phase !== "playing" || message.roundId !== this.state.currentRoundId) return;
      // The server owns the listening deadline; a media event cannot shorten it.
      await this.advanceDue();
      return;
    }
  }

  private async handlePlayerAction(message: ClientMessage, playerId: PlayerId, connection: RoomConnection) {
    const player = this.state.playersById[playerId];
    if (!player) {
      this.sendError(connection, "not_player", "Player session is not registered in this room.");
      return;
    }
    player.lastSeenAt = nowMs();
    if (this.state.online && (await this.handleOnlineAction(message, playerId, connection))) return;
    if (message.type === "player_final_vote" || message.type === "player_mode_vote") {
      const initial = message.type === "player_mode_vote";
      const vote = initial ? this.state.initialVote : this.state.finalVote;
      if (this.state.phase !== (initial ? "mode_select" : "finished") || !vote) {
        this.sendError(connection, "bad_phase", "Голосование сейчас недоступно.");
        return;
      }
      if (activePlayers(this.state).length < minimumPlayersForMode(message.mode)) {
        this.sendError(
          connection,
          "bad_phase",
          `Для этого режима нужны минимум ${minimumPlayersForMode(message.mode)} игрока.`,
        );
        return;
      }
      if (vote.decision) return;
      vote.votes[playerId] = message.mode;
      this.resolveFinalVotes();
      this.touch();
      await this.persistAndBroadcast();
      return;
    }
    if (message.type === "player_leave") {
      delete this.state.playersById[playerId];
      delete this.state.playerTokens[playerId];
      if (this.state.quiz) {
        delete this.state.quiz.answers[playerId];
        this.state.quiz.answeredPlayerIds = Object.keys(this.state.quiz.answers);
      }
      if (this.state.freestyle) {
        delete this.state.freestyle.submissions[playerId];
        delete this.state.freestyle.votes[playerId];
        for (const [voter, target] of Object.entries(this.state.freestyle.votes))
          if (target === playerId) delete this.state.freestyle.votes[voter];
        this.syncFreestylePublicState();
      }
      for (const [client, id] of Object.entries(this.state.playerIdByClientId))
        if (id === playerId) delete this.state.playerIdByClientId[client];
      if (this.state.finalVote) delete this.state.finalVote.votes[playerId];
      if (this.state.initialVote) delete this.state.initialVote.votes[playerId];
      for (const socket of this.room.connections())
        if (socket.state?.role === "player" && socket.state.playerId === playerId) {
          socket.setState({ role: "spectator", clientId: socket.state.clientId });
          socket.send(JSON.stringify({ type: "player_left" } satisfies ServerMessage));
        }
      if (
        !this.state.online &&
        this.isActive() &&
        activePlayers(this.state).length < minimumPlayersForMode(this.state.mode)
      ) {
        await this.finishGame();
        return;
      }
      if (
        this.state.phase === "rules" &&
        activePlayers(this.state).length < minimumPlayersForMode(this.state.mode)
      ) {
        this.state.phase = "lobby";
        this.state.mode = null;
        this.state.initialVote = null;
        this.state.rosterLocked = false;
        this.state.nextAdvanceAt = null;
      }
      if (!this.state.pausedAt) {
        if (
          this.state.phase === "quiz_answering" &&
          this.state.quiz &&
          this.allConnectedPlayersDone(this.state.quiz.answeredPlayerIds)
        ) {
          await this.finalizeQuizRound();
          return;
        }
        if (
          this.state.phase === "freestyle_submitting" &&
          this.state.freestyle &&
          this.allConnectedPlayersDone(this.state.freestyle.submittedPlayerIds)
        ) {
          await this.enterFreestyleVoting();
          return;
        }
        if (this.state.phase === "freestyle_voting" && this.allEligibleVotersDone()) {
          await this.finalizeFreestyleRound();
          return;
        }
      }
      this.resolveFinalVotes();
      this.touch();
      await this.persistAndBroadcast();
      return;
    }
    if (message.type === "player_replay") {
      const eligible =
        this.state.phase === "quiz_answering"
          ? !this.state.quiz?.answers[playerId]
          : this.state.phase === "freestyle_submitting"
            ? !this.state.freestyle?.submissions[playerId]
            : false;
      if (!eligible || this.state.replay || !this.state.hostConnected || this.state.deadlineAt === null) {
        this.sendError(connection, "bad_phase", "Повтор сейчас недоступен.");
        return;
      }
      this.state.replay = {
        id: id("replay"),
        requestedBy: playerId,
        startedAt: null,
        endsAt: null,
        remainingMs: Math.max(0, this.state.deadlineAt - nowMs()),
      };
      this.state.deadlineAt = null;
      this.state.nextAdvanceAt = nowMs() + 30_000;
      this.touch();
      await this.persistAndBroadcast();
      return;
    }
    if (this.state.deadlineAt !== null && nowMs() >= this.state.deadlineAt) {
      this.sendError(connection, "bad_phase", "Время ответа истекло.");
      return;
    }

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
      if (this.state.quiz.answers[playerId]) {
        this.sendSnapshot(connection, "player", false, false);
        return;
      }
      if (
        message.answer.variant !== this.state.quiz.variant ||
        (message.answer.variant === "order" &&
          (message.answer.orderIds.length !== this.state.quiz.correctOrderIds.length ||
            new Set(message.answer.orderIds).size !== message.answer.orderIds.length ||
            message.answer.orderIds.some((value) => !this.state.quiz!.correctOrderIds.includes(value))))
      ) {
        this.sendError(connection, "invalid_message", "Ответ не соответствует заданию.");
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
      if (this.state.freestyle.submissions[playerId]) {
        this.sendSnapshot(connection, "player", false, false);
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
      if (this.state.freestyle.votes[playerId]) {
        this.sendSnapshot(connection, "player", false, false);
        return;
      }
      if (message.submissionId === playerId) {
        this.sendError(connection, "self_vote", "Players cannot vote for their own answer.");
        return;
      }
      if (
        !canVoteForSubmission(playerId, message.submissionId, Object.keys(this.state.freestyle.submissions))
      ) {
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
    this.state.finalVote = null;
    this.state.initialVote = null;
    this.state.rosterLocked = true;
    const community = (await this.room.publishedRounds?.()) ?? [];
    const pool = [...seedRounds, ...community];
    let order =
      this.isTest() && !this.state.online && !this.state.code.startsWith("E2EF")
        ? (this.state.mode === "quiz" ? [1, 2, 3] : [1, 3, 4]).map(
            (id) => pool.find((round) => round.id === id)!,
          )
        : buildMultiplayerRoundOrder(this.state.mode, pool);
    if (this.state.online) {
      order = order.slice(0, 5);
      this.state.online.endedEarly = false;
      this.state.online.quorumDeadlineAt = null;
    }
    this.state.roundSnapshots = structuredClone(order);
    this.state.roundOrderIds = order.map((round) => round.id);
    this.state.quizPayloads = {};
    if (this.state.mode === "quiz") {
      const prior = new Set<string>();
      for (const round of order) {
        const payload = buildQuizRoundPayload(round, prior, pool);
        this.state.quizPayloads[round.id] = payload;
        prior.add(payload.correctAnswer);
      }
    }
    this.state.totalRounds = this.state.roundOrderIds.length;
    this.state.currentRoundIndex = 0;
    this.state.priorCorrectAnswers = [];
    await this.enterTransition();
  }

  private async enterTransition() {
    this.state.replay = null;
    if (this.state.online) {
      this.state.online.mediaReadyPlayerIds = [];
      this.state.online.eligiblePlayerIds = [];
      this.state.online.mediaLoadDeadlineAt = nowMs() + (this.isTest() ? 3000 : 15000);
      this.state.onlineReplays = {};
      this.state.onlineSubmissionIds = {};
    }
    const roundId = this.state.roundOrderIds[this.state.currentRoundIndex] ?? null;
    const round = this.state.roundSnapshots.find((item) => item.id === roundId) ?? roundById(roundId);
    if (!round) {
      await this.finishGame();
      return;
    }
    this.state.phase = "transition";
    this.state.backgroundStartedAt = nowMs();
    this.state.answerSeconds = this.isTest() ? 5 : guessSecondsFor(round.revealLineIds.length);
    this.state.voteSeconds = this.isTest() ? 5 : MULTIPLAYER_FREESTYLE_VOTE_SECONDS;
    this.state.turnId = id("turn");
    this.state.playingStartedAt = null;
    this.state.currentRoundId = round.id;
    this.state.upcomingRoundTitle = round.title;
    this.state.deadlineAt = null;
    this.state.transitionUntil = nowMs() + (this.isTest() ? 300 : MULTIPLAYER_TRANSITION_MS);
    this.state.nextAdvanceAt = null;
    this.state.roundResult = null;
    this.state.freestyle = null;
    this.state.quiz = null;
    if (this.state.mode === "quiz") {
      const payload =
        this.state.quizPayloads[round.id] ??
        buildQuizRoundPayload(round, new Set(this.state.priorCorrectAnswers), this.state.roundSnapshots);
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
  }

  private async enterPlaying() {
    if (this.state.phase !== "transition") return;
    this.state.phase = "playing";
    this.state.transitionUntil = null;
    this.state.playingStartedAt = null;
    this.state.nextAdvanceAt = nowMs() + 30_000;
    this.touch();
    await this.persistAndBroadcast();
  }

  private async enterAnswerPhase() {
    const round = currentRound(this.state);
    if (!round) return;
    const deadlineAt = nowMs() + (this.isTest() ? 5 : guessSecondsFor(round.revealLineIds.length)) * 1_000;
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
  }

  private async enterFreestyleVoting() {
    this.state.replay = null;
    if (!this.state.freestyle) return;
    this.state.phase = "freestyle_voting";
    this.state.deadlineAt = nowMs() + (this.isTest() ? 5 : MULTIPLAYER_FREESTYLE_VOTE_SECONDS) * 1_000;
    this.syncFreestylePublicState();
    this.touch();
    if (this.state.freestyle.votingOptions.length <= 1 || this.allEligibleVotersDone()) {
      await this.finalizeFreestyleRound();
      return;
    }
    await this.persistAndBroadcast();
  }

  private async finalizeQuizRound() {
    this.state.replay = null;
    const quiz = this.state.quiz;
    const round = currentRound(this.state);
    if (!quiz || !round) return;
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
    this.state.nextAdvanceAt = nowMs() + (this.isTest() ? 3_000 : MULTIPLAYER_ROUND_RESULTS_MS);
    this.touch();
    await this.persistAndBroadcast();
  }

  private async finalizeFreestyleRound() {
    this.state.replay = null;
    const freestyle = this.state.freestyle;
    const round = currentRound(this.state);
    if (!freestyle || !round) return;

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
    const tiedWinners =
      maxVotes > 0 ? submittedIds.filter((playerId) => (voteCounts.get(playerId) ?? 0) === maxVotes) : [];
    const tieBrokenWinner =
      tiedWinners.length > 1
        ? tiedWinners[
            Math.floor((crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32) * tiedWinners.length)
          ]!
        : (tiedWinners[0] ?? null);

    if (tieBrokenWinner && submittedIds.length > 0) {
      this.state.playersById[tieBrokenWinner]!.score += 1;
    }

    const submissions: FreestyleRoundResult["submissions"] = submittedIds.map((playerId) => {
      const submission = freestyle.submissions[playerId]!;
      const similarity = compareAnswerSimilarity(submission.text, originalAnswer).score;
      const similarityBonus = similarity >= FREESTYLE_SIMILARITY_THRESHOLD;
      if (similarityBonus) this.state.playersById[playerId]!.score += 1;
      return {
        playerId,
        name: this.state.playersById[playerId]?.name ?? "Игрок",
        text: submission.text,
        votes: voteCounts.get(playerId) ?? 0,
        similarity,
        similarityBonus,
        votingWinner: playerId === tieBrokenWinner,
        tieBrokenWinner: playerId === tieBrokenWinner,
      };
    });

    const tieBreakNote =
      tiedWinners.length > 1
        ? `Ничья по голосам: жеребьёвка выбрала победителя (${this.state.playersById[tieBrokenWinner!]?.name ?? "игрок"}).`
        : maxVotes === 0
          ? "Нет голосов — бонус за голосование не начислен."
          : null;

    this.state.roundResult = {
      kind: "freestyle",
      originalAnswer,
      similarityThreshold: FREESTYLE_SIMILARITY_THRESHOLD,
      submissions,
      winnerPlayerIds: tieBrokenWinner ? [tieBrokenWinner] : [],
      tieBreakNote,
    };
    this.state.phase = "round_results";
    this.state.deadlineAt = null;
    this.state.nextAdvanceAt = nowMs() + (this.isTest() ? 3_000 : MULTIPLAYER_ROUND_RESULTS_MS);
    this.touch();
    await this.persistAndBroadcast();
  }

  private async finishGame() {
    this.state.replay = null;
    this.state.manualPaused = false;
    this.state.pausedAt = null;
    this.state.phase = "finished";
    this.state.finalVote = { votes: {}, decision: null };
    this.state.rosterLocked = false;
    this.state.deadlineAt = null;
    this.state.transitionUntil = null;
    this.state.nextAdvanceAt = null;
    this.touch();
    await this.persistAndBroadcast();
  }

  private resolveFinalVotes() {
    if (this.state.online) {
      this.resolveOnlineMode();
      return;
    }
    const initial = this.state.phase === "mode_select";
    const vote = initial ? this.state.initialVote : this.state.finalVote;
    if ((!initial && this.state.phase !== "finished") || !vote) return;
    const players = activePlayers(this.state);
    if (initial && players.length < MIN_PLAYERS) {
      this.state.phase = "lobby";
      this.state.initialVote = null;
      this.state.mode = null;
      this.state.rosterLocked = false;
      this.state.nextAdvanceAt = null;
      return;
    }
    if (initial && players.length === 2) {
      this.state.mode = "quiz";
      this.state.phase = "rules";
      this.state.rosterLocked = true;
      this.state.initialVote = null;
      this.state.nextAdvanceAt = null;
      return;
    }
    if (players.length < MIN_PLAYERS || !this.state.hostConnected) {
      vote.decision = null;
      this.state.rosterLocked = false;
      this.state.nextAdvanceAt = null;
      return;
    }
    for (const [playerId, mode] of Object.entries(vote.votes))
      if (players.length < minimumPlayersForMode(mode)) delete vote.votes[playerId];
    if (vote.decision && players.length < minimumPlayersForMode(vote.decision.mode)) {
      this.state.rosterLocked = false;
      vote.decision = null;
      this.state.nextAdvanceAt = null;
    }
    if (vote.decision) return;
    const counts = { quiz: 0, freestyle: 0 };
    for (const player of players) {
      const mode = vote.votes[player.id];
      if (mode) counts[mode]++;
    }
    const max = Math.max(counts.quiz, counts.freestyle);
    const allVoted = counts.quiz + counts.freestyle === players.length;
    if (max <= players.length / 2 && !allVoted) return;
    const tied = counts.quiz === counts.freestyle;
    const mode = tied
      ? crypto.getRandomValues(new Uint8Array(1))[0]! % 2
        ? "quiz"
        : "freestyle"
      : counts.quiz > counts.freestyle
        ? "quiz"
        : "freestyle";
    const startsAt = nowMs() + (this.isTest() ? 800 : 4_000);
    vote.decision = { mode, random: tied, startsAt };
    this.state.rosterLocked = true;
    this.state.nextAdvanceAt = startsAt;
  }

  private isTest() {
    return this.room.testMode && this.state.code.startsWith("E2E");
  }

  private isActive() {
    return !["lobby", "mode_select", "rules", "finished", "expired"].includes(this.state.phase);
  }

  private nextAlarmAt(): number {
    if (this.state.online) return this.nextOnlineAlarmAt();
    const due =
      this.state.pausedAt || !this.isActive()
        ? this.state.expiresAt
        : (this.state.transitionUntil ??
          (this.state.replay ? this.state.nextAdvanceAt : this.state.deadlineAt) ??
          this.state.nextAdvanceAt ??
          this.state.expiresAt);
    const next =
      ["mode_select", "finished"].includes(this.state.phase) && this.state.nextAdvanceAt !== null
        ? Math.min(due, this.state.nextAdvanceAt)
        : due;
    return this.state.hostConnected && this.state.hostLastSeenAt !== null
      ? Math.min(next, this.state.hostLastSeenAt + 30_000)
      : next;
  }

  private async save() {
    await this.room.save(this.state, this.nextAlarmAt());
  }

  async onAlarm() {
    await this.advanceDue();
    await this.save();
  }

  private async advanceDue() {
    if (this.state.online) {
      await this.advanceOnlineDue();
      return;
    }
    if (this.state.phase === "expired") return;
    if (
      this.state.hostConnected &&
      this.state.hostLastSeenAt !== null &&
      nowMs() - this.state.hostLastSeenAt >= 30_000
    ) {
      this.state.hostConnected = false;
      if (this.isActive() && !this.state.pausedAt) this.state.pausedAt = nowMs();
      this.state.expiresAt = nowMs() + 30 * 60_000;
      this.touch(false);
      await this.persistAndBroadcast();
      return;
    }
    if ((this.state.pausedAt || !this.isActive()) && nowMs() >= this.state.expiresAt) {
      this.state.phase = "expired";
      this.state.deadlineAt = null;
      this.state.transitionUntil = null;
      this.state.nextAdvanceAt = null;
      this.state.pausedAt = null;
      this.state.hostToken = null;
      this.state.playerTokens = {};
      this.touch();
      await this.persistAndBroadcast();
      return;
    }
    if (this.state.pausedAt) return;
    const initial = this.state.phase === "mode_select";
    const decision = initial ? this.state.initialVote?.decision : this.state.finalVote?.decision;
    if (
      (initial || this.state.phase === "finished") &&
      decision &&
      this.state.nextAdvanceAt !== null &&
      this.state.nextAdvanceAt <= nowMs()
    ) {
      if (
        activePlayers(this.state).length < minimumPlayersForMode(decision.mode) ||
        !this.state.hostConnected
      ) {
        this.resolveFinalVotes();
        await this.persistAndBroadcast();
        return;
      }
      this.state.mode = decision.mode;
      if (initial) {
        this.state.phase = "rules";
        this.state.nextAdvanceAt = null;
        this.touch();
        await this.persistAndBroadcast();
      } else await this.startGame(true);
      return;
    }
    if (this.state.replay && this.state.nextAdvanceAt !== null && this.state.nextAdvanceAt <= nowMs()) {
      if (this.state.replay.startedAt === null) {
        this.state.pausedAt = nowMs();
        this.touch(false);
      } else {
        this.state.deadlineAt = nowMs() + this.state.replay.remainingMs;
        this.state.replay = null;
        this.state.nextAdvanceAt = null;
        this.touch();
      }
      await this.persistAndBroadcast();
      return;
    }
    const due = this.state.transitionUntil ?? this.state.deadlineAt ?? this.state.nextAdvanceAt;
    if (due === null || due > nowMs()) return;
    if (this.state.phase === "transition") await this.enterPlaying();
    else if (this.state.phase === "playing") {
      if (this.state.playingStartedAt === null) {
        this.state.pausedAt = nowMs();
        this.state.expiresAt = nowMs() + 30 * 60_000;
        this.touch(false);
        await this.persistAndBroadcast();
      } else await this.enterAnswerPhase();
    } else if (this.state.phase === "round_results") await this.advanceAfterResults();
    else await this.onDeadline();
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

  private allConnectedPlayersDone(donePlayerIds: PlayerId[]): boolean {
    const done = new Set(donePlayerIds);
    const participants = this.state.online
      ? activePlayers(this.state).filter((p) => this.state.online!.eligiblePlayerIds.includes(p.id))
      : orderedPlayers(this.state);
    return participants.length > 0 && participants.every((player) => done.has(player.id));
  }

  private allEligibleVotersDone(): boolean {
    const freestyle = this.state.freestyle;
    if (!freestyle) return false;
    const submissions = new Set(Object.keys(freestyle.submissions));
    const eligible = orderedPlayers(this.state).filter(
      (player) =>
        (!this.state.online ||
          (player.connected && this.state.online.eligiblePlayerIds.includes(player.id))) &&
        [...submissions].some((submissionId) => submissionId !== player.id),
    );
    return eligible.length === 0 || eligible.every((player) => !!freestyle.votes[player.id]);
  }

  private syncFreestylePublicState() {
    const freestyle = this.state.freestyle;
    if (!freestyle) return;
    freestyle.submittedPlayerIds = Object.keys(freestyle.submissions);
    freestyle.votedPlayerIds = Object.keys(freestyle.votes);
    if (this.state.online && ["freestyle_voting", "round_results", "finished"].includes(this.state.phase)) {
      const aliases = (this.state.onlineSubmissionIds ??= {});
      for (const playerId of Object.keys(freestyle.submissions)) aliases[playerId] ??= id("submission");
    }
    freestyle.votingOptions =
      this.state.phase === "freestyle_voting" ||
      this.state.phase === "round_results" ||
      this.state.phase === "finished"
        ? Object.entries(freestyle.submissions)
            .map(([submissionId, submission]) => ({
              submissionId: this.state.online ? this.state.onlineSubmissionIds![submissionId]! : submissionId,
              text: submission.text,
              submittedAt: this.state.online ? 0 : submission.submittedAt,
            }))
            .sort((a, b) => a.submittedAt - b.submittedAt || a.submissionId.localeCompare(b.submissionId))
        : [];
  }

  private answerLabel(answer: QuizAnswer, round: NonNullable<ReturnType<typeof currentRound>>): string {
    if (answer.variant === "mc4") {
      return this.state.quiz?.options[answer.selectedIndex] ?? `Вариант ${answer.selectedIndex + 1}`;
    }
    return answer.orderIds
      .map((lineId) => round.lyrics.find((line) => line.id === lineId)?.text ?? "—")
      .join(" / ");
  }

  private publicState(): PublicRoomState {
    const players = orderedPlayers(this.state);
    const showCorrect = this.state.phase === "round_results" || this.state.phase === "finished";
    return {
      code: this.state.code,
      online: this.state.online,
      phase: this.state.phase,
      mode: this.state.mode,
      minPlayers: this.state.minPlayers,
      maxPlayers: this.state.maxPlayers,
      hostConnected: this.state.hostConnected,
      players: players.map(({ id, name, score, connected, joinedAt, lastSeenAt }) => ({
        id,
        name,
        score,
        connected,
        joinedAt,
        lastSeenAt,
      })),
      pausedAt: this.state.pausedAt,
      manualPaused: this.state.manualPaused,
      replay: this.state.replay,
      expiresAt: this.state.expiresAt,
      discord: this.state.discord,
      turnId: this.state.turnId,
      playingStartedAt: this.state.playingStartedAt,
      backgroundStartedAt: this.state.backgroundStartedAt,
      answerSeconds: this.state.answerSeconds,
      voteSeconds: this.state.voteSeconds,
      finalVote: this.state.finalVote,
      initialVote: this.state.initialVote,
      rosterLocked: this.state.rosterLocked,
      currentRoundIndex: this.state.currentRoundIndex,
      totalRounds: this.state.totalRounds,
      currentRoundId: this.state.currentRoundId,
      round: (() => {
        const round = currentRound(this.state);
        return round && !showCorrect
          ? { ...round, lyrics: round.lyrics.filter((line) => round.hintLineIds.includes(line.id)) }
          : round;
      })(),
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

  private async markDisconnected(connection: RoomConnection) {
    const meta = connection.state;
    if (!meta || meta.role === "spectator") return;
    const others = [...this.room.connections()].filter((c) => c.id !== connection.id);
    if (meta.role === "host") {
      if (connection.id !== this.state.activeHostConnectionId) return;
      this.state.hostConnected = false;
      if (!this.state.online && this.isActive() && !this.state.pausedAt) this.state.pausedAt = nowMs();
      this.state.expiresAt = nowMs() + 30 * 60_000;
    }
    if (meta.role === "player") {
      const player = this.state.playersById[meta.playerId];
      if (others.some((c) => c.state?.role === "player" && c.state.playerId === meta.playerId)) return;
      if (player) {
        player.connected = false;
        player.lastSeenAt = nowMs();
        if (
          this.state.online &&
          this.isActive() &&
          activePlayers(this.state).length < minimumPlayersForMode(this.state.mode)
        )
          this.state.online.quorumDeadlineAt ??= nowMs() + 30000;
      }
    }
    if (
      this.state.phase === "rules" &&
      activePlayers(this.state).length < minimumPlayersForMode(this.state.mode)
    ) {
      this.state.phase = activePlayers(this.state).length < MIN_PLAYERS ? "lobby" : "mode_select";
      this.state.mode = null;
      this.state.initialVote = this.state.phase === "mode_select" ? { votes: {}, decision: null } : null;
      this.state.rosterLocked = false;
    }
    this.resolveFinalVotes();
    this.touch(false);
    await this.persistAndBroadcast();
  }

  private touch(extendExpiry = true) {
    this.state.updatedAt = nowMs();
    if (extendExpiry && !this.state.pausedAt) this.state.expiresAt = nowMs() + 30 * 60_000;
  }

  private async persistAndBroadcast(
    directConnection?: RoomConnection,
    directRole?: "host" | "player" | "spectator",
    directReconnected = false,
  ) {
    await this.save();
    for (const connection of this.room.connections()) {
      if (directConnection && connection.id === directConnection.id && directRole) {
        this.sendSnapshot(connection, directRole, directReconnected, false);
      } else {
        const role = connection.state?.role ?? "spectator";
        this.sendSnapshot(connection, role, false, false);
      }
    }
  }

  private sendSnapshot(
    connection: RoomConnection,
    role: "host" | "player" | "spectator",
    reconnected: boolean,
    restoring: boolean,
  ) {
    const meta = connection.state;
    const message: ServerMessage = {
      type: "snapshot",
      serverNow: nowMs(),
      state: this.publicState(),
      you: {
        role,
        clientId: meta?.clientId ?? "pending",
        playerId: meta?.role === "player" ? meta.playerId : undefined,
        reconnected,
        restoring,
        own:
          meta?.role === "player"
            ? {
                quizAnswer: this.state.quiz?.answers[meta.playerId] ?? null,
                submission: this.state.freestyle?.submissions[meta.playerId]?.text ?? null,
                submissionId: this.state.onlineSubmissionIds?.[meta.playerId],
                votedSubmissionId: this.state.online
                  ? (this.state.onlineSubmissionIds?.[this.state.freestyle?.votes[meta.playerId] ?? ""] ??
                    null)
                  : (this.state.freestyle?.votes[meta.playerId] ?? null),
                personalReplay: this.state.onlineReplays?.[meta.playerId] ?? null,
              }
            : undefined,
      },
    };
    connection.send(JSON.stringify(message));
  }

  private sendError(
    connection: RoomConnection,
    code: Extract<ServerMessage, { type: "error" }>["code"],
    message: string,
  ) {
    connection.send(JSON.stringify({ type: "error", code, message } satisfies ServerMessage));
  }
}

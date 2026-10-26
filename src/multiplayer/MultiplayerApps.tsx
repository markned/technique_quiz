import { ReplayWithPlayIcon } from "../components/ReplayWithPlayIcon";
import { AdmissionPanel } from "./admission";
import { forgetRoom } from "../navigation";
import { RoomMenu } from "./RoomMenu";
import { LyricsPanel } from "../components/LyricsPanel";
import { FormEvent, useEffect, useRef, useState, type ReactNode } from "react";
import { minimumPlayersForMode } from "./types";
import type { ClientMessage } from "./messages";
import type { LeaderboardRow, PublicRoomState, RoomCode, PrivatePlayerState } from "./types";
import { usePartyRoom } from "./usePartyRoom";
import { getSavedPlayerName, getOrCreateHostToken, normalizeRoomCode, rememberPlayerName } from "./identity";
import { hostPath, playerPath, publicJoinUrl } from "./routes";
import { publicGameOrigin } from "./env";
import { roundById } from "./rounds";
import { pickLyricLines } from "../helpers/lyrics";
import {
  fragmentStopTimeSec,
  getGuessSeconds,
  OUTRO_QUIZ_VIDEOS,
  outroQuizVideoIndexForScore,
} from "../helpers/quizConfig";
import { visibleHintCountAtTime } from "../helpers/quizPlayback";
import { toLocalMediaUrl } from "../helpers/media";
import { LocalMediaPlayer } from "../adapters/localMediaPlayer";
import type { PlayerAdapter } from "../adapters/player";
import type { RoundState } from "../types";
import { QuizBackground } from "../components/QuizBackground";
import { DockChromaKeyLayer } from "../components/DockChromaKeyLayer";
import { RulesScreen } from "../components/RulesScreen";
import { QuizScreen } from "../components/QuizScreen";
import { MultiplayerScene } from "./MultiplayerScene";
import { Timer } from "../components/Timer";
import { useQuizContentFit } from "../hooks/useQuizContentFit";
import { TransitionOverlay } from "../components/TransitionOverlay";
import { multiplayerRoundBackground } from "../helpers/roundBackground";

function roomTimer(state: PublicRoomState) {
  const round = state.round ?? roundById(state.currentRoundId);
  const total =
    state.phase === "freestyle_voting"
      ? (state.voteSeconds ?? 45)
      : (state.answerSeconds ??
        getGuessSeconds(state.quiz?.answerLineCount ?? round?.revealLineIds.length ?? 1));
  const seconds = state.replay
    ? Math.ceil(state.replay.remainingMs / 1000)
    : state.deadlineAt === null
      ? total
      : Math.min(total, Math.max(0, Math.ceil((state.deadlineAt - (state.pausedAt ?? Date.now())) / 1000)));
  return { total, seconds };
}

function useRoomTimer(state: PublicRoomState) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!state.deadlineAt || state.pausedAt) return;
    const interval = window.setInterval(() => tick((value) => value + 1), 200);
    return () => window.clearInterval(interval);
  }, [state.deadlineAt, state.pausedAt]);
  return roomTimer(state);
}

function useSharedHintCount(state: PublicRoomState) {
  const [now, tick] = useState(Date.now);
  useEffect(() => {
    if (state.pausedAt || (!state.replay && state.phase !== "playing")) return;
    const timer = window.setInterval(() => tick(Date.now()), 80);
    return () => window.clearInterval(timer);
  }, [state.pausedAt, state.phase, state.replay?.id]);
  const round = state.round ?? roundById(state.currentRoundId);
  if (!round) return 0;
  if (!state.replay && state.phase !== "playing") return round.hintLineIds.length;
  const start = state.replay ? state.replay.startedAt : state.playingStartedAt;
  if (start === null) return 0;
  return visibleHintCountAtTime(
    round.start + Math.max(0, ((state.pausedAt ?? now) - start) / 1000),
    round,
    round.hintLineIds.length,
  );
}

function ReplayButton({
  state,
  playerId,
  send,
}: {
  state: PublicRoomState;
  playerId: string;
  send: (message: ClientMessage) => boolean;
}) {
  const [now, tick] = useState(Date.now);
  useEffect(() => {
    if (!state.replay || state.pausedAt) return;
    const t = setInterval(() => tick(Date.now()), 200);
    return () => clearInterval(t);
  }, [state.replay, state.pausedAt]);
  const done =
    state.phase === "quiz_answering"
      ? state.quiz?.answeredPlayerIds.includes(playerId)
      : state.freestyle?.submittedPlayerIds.includes(playerId);
  if (!["quiz_answering", "freestyle_submitting"].includes(state.phase) || done) return null;
  const seconds = state.replay?.endsAt
    ? Math.max(0, Math.ceil((state.replay.endsAt - (state.pausedAt ?? now)) / 1000))
    : 0;
  return (
    <button
      type="button"
      className="dock-btn dock-btn-replay multiplayer-replay"
      aria-label={
        state.replay ? (seconds ? `Повтор · ${seconds} с` : "Готовим повтор…") : "Повторить фрагмент"
      }
      title="Повторить фрагмент"
      disabled={!!state.replay || !!state.pausedAt}
      onClick={() => send({ type: "player_replay", turnId: state.turnId })}
    >
      <ReplayWithPlayIcon />
      {state.replay ? (
        <span className="multiplayer-replay-count" aria-hidden="true">
          {seconds || "…"}
        </span>
      ) : null}
    </button>
  );
}

function playerStatus(state: PublicRoomState, playerId: string) {
  if (!state.players.find((p) => p.id === playerId)?.connected) return "Нет связи";
  if (state.pausedAt) return "Пауза";
  if (state.phase === "quiz_answering")
    return state.quiz?.answeredPlayerIds.includes(playerId) ? "Ответил" : "Думает";
  if (state.phase === "freestyle_submitting")
    return state.freestyle?.submittedPlayerIds.includes(playerId) ? "Отправил" : "Пишет";
  if (state.phase === "freestyle_voting")
    return state.freestyle?.votedPlayerIds.includes(playerId) ? "Проголосовал" : "Голосует";
  if (state.phase === "playing") return "Слушает";
  if (state.phase === "round_results" && state.roundResult?.kind === "quiz")
    return state.roundResult.correctPlayerIds.includes(playerId) ? "Верно · +1" : "Неверно · +0";
  if (state.phase === "round_results" && state.roundResult?.kind === "freestyle") {
    const result = state.roundResult.submissions.find((item) => item.playerId === playerId);
    return result
      ? `Голосов: ${result.votes} · +${Number(result.tieBrokenWinner) + Number(result.similarityBonus)}`
      : "Нет ответа · +0";
  }
  return "В игре";
}

function RoundProgress({ state }: { state: PublicRoomState }) {
  const ids =
    state.phase === "quiz_answering"
      ? state.quiz?.answeredPlayerIds
      : state.phase === "freestyle_submitting"
        ? state.freestyle?.submittedPlayerIds
        : state.phase === "freestyle_voting"
          ? state.freestyle?.votedPlayerIds
          : undefined;
  if (!ids) return null;
  return (
    <p className="multiplayer-round-progress" role="status">
      {state.phase === "freestyle_voting" ? "Проголосовали" : "Ответили"} {ids.length} из{" "}
      {state.players.length}
    </p>
  );
}

function PlayerRoundInformation({
  state,
  playerId,
  own,
}: {
  state: PublicRoomState;
  playerId?: string;
  own?: PrivatePlayerState;
}) {
  const round = state.round ?? roundById(state.currentRoundId);
  const result = state.phase === "round_results" ? state.roundResult : null;
  const myQuiz = result?.kind === "quiz" ? result.playerResults.find((p) => p.playerId === playerId) : null;
  const myFreestyle =
    result?.kind === "freestyle" ? result.submissions.find((p) => p.playerId === playerId) : null;
  const answer = own?.quizAnswer;
  const ownLabel =
    answer?.variant === "mc4"
      ? state.quiz?.options[answer.selectedIndex]
      : answer?.variant === "order"
        ? answer.orderIds.map((id) => round?.lyrics.find((line) => line.id === id)?.text).join("\n")
        : own?.submission;
  const vote = own?.votedSubmissionId
    ? state.freestyle?.votingOptions.find((option) => option.submissionId === own.votedSubmissionId)?.text
    : null;
  return (
    <section className="multiplayer-personal-round">
      {round ? <h2>{round.title}</h2> : null}
      {round && (ownLabel || myQuiz || myFreestyle) ? (
        <div className="multiplayer-hint-bars">
          {pickLyricLines(round.lyrics, round.hintLineIds).map((line) => (
            <p className="lyric-line genius-bar" key={line.id}>
              {line.text}
            </p>
          ))}
        </div>
      ) : null}
      {ownLabel || myQuiz || myFreestyle ? (
        <>
          <p className="multiplayer-eyebrow">Ваш ответ</p>
          <p className="lyric-line genius-bar multiplayer-answer-bar">
            {myQuiz?.answerLabel ?? myFreestyle?.text ?? ownLabel}
          </p>
        </>
      ) : null}
      {vote ? (
        <>
          <p className="multiplayer-eyebrow">Вы проголосовали за</p>
          <p className="lyric-line genius-bar multiplayer-answer-bar">{vote}</p>
        </>
      ) : null}
      {result ? (
        <>
          <p className="multiplayer-eyebrow">
            {result.kind === "quiz" ? "Правильный ответ" : "Оригинальный текст"}
          </p>
          <p className="lyric-line genius-bar">
            {result.kind === "quiz" ? result.correctAnswer : result.originalAnswer}
          </p>
          <p className="multiplayer-personal-points">
            {myQuiz
              ? myQuiz.correct
                ? "Верно · +1 очко"
                : "Неверно · +0 очков"
              : myFreestyle
                ? `Голосов: ${myFreestyle.votes} · +${Number(myFreestyle.tieBrokenWinner) + Number(myFreestyle.similarityBonus)} очк.`
                : "Нет ответа · +0 очков"}
          </p>
        </>
      ) : null}
    </section>
  );
}

function StatusLine({ status, error }: { status: string; error: string | null }) {
  if (error) return <p className="multiplayer-status multiplayer-status--error">{error}</p>;
  if (status !== "connected") {
    return <p className="multiplayer-status">Восстанавливаем подключение…</p>;
  }
  return null;
}

function RestoredToast({ visible }: { visible: boolean }) {
  const [shown, setShown] = useState(visible);
  useEffect(() => {
    if (!visible) {
      setShown(false);
      return;
    }
    setShown(true);
    const timer = window.setTimeout(() => setShown(false), 2500);
    return () => window.clearTimeout(timer);
  }, [visible]);
  return shown ? (
    <div className="multiplayer-toast" role="status">
      Сессия восстановлена
    </div>
  ) : null;
}

function InvalidRoomCodeScreen({ code }: { code: RoomCode }) {
  return (
    <main className="app-shell rules-screen-shell multiplayer-shell">
      <section className="rules-screen-card multiplayer-panel multiplayer-controller-card">
        <p className="multiplayer-eyebrow">Комната</p>
        <h1 className="rules-screen-title">Неверный код</h1>
        <p className="multiplayer-status multiplayer-status--error" role="alert">
          Код «{code || "—"}» не похож на 6-символьный код комнаты.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-hero"
          onClick={() => (window.location.href = "/")}
        >
          На старт
        </button>
      </section>
    </main>
  );
}

function useSecondsUntil(targetAt: number | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!targetAt) return undefined;
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);

    function tick() {
      setNow(Date.now());
    }
  }, [targetAt]);

  return targetAt ? Math.max(0, Math.ceil((targetAt - now) / 1_000)) : null;
}

function CountdownPill({ label, targetAt }: { label: string; targetAt: number | null | undefined }) {
  const seconds = useSecondsUntil(targetAt);
  if (seconds === null) return null;
  return (
    <p className="multiplayer-countdown" aria-live="polite">
      {label}: {seconds}
    </p>
  );
}

function Leaderboard({
  rows,
  title = "Таблица",
  finale = false,
  state,
}: {
  rows: LeaderboardRow[];
  title?: string;
  finale?: boolean;
  state?: PublicRoomState;
}) {
  return (
    <section
      className={`multiplayer-leaderboard ${finale ? "multiplayer-leaderboard--finale" : ""}`}
      aria-label={title}
    >
      <h2>{title}</h2>
      <ol>
        {rows.map((row) => (
          <li key={row.playerId} className={!row.connected ? "is-disconnected" : ""}>
            <span className="multiplayer-leaderboard-name">
              {row.rank}. {row.name}
            </span>
            <strong>{row.score} очк.</strong>
            {state ? (
              <small className="multiplayer-player-status">{playerStatus(state, row.playerId)}</small>
            ) : null}
            {state?.phase === "round_results" && state.roundResult?.kind === "quiz" ? (
              <small className="multiplayer-player-answer">
                {
                  state.roundResult.playerResults.find((result) => result.playerId === row.playerId)
                    ?.answerLabel
                }
              </small>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function PlayerRoster({ state }: { state: PublicRoomState }) {
  return (
    <div className="multiplayer-player-grid" aria-label="Игроки">
      {state.players.map((player) => (
        <span
          key={player.id}
          className={`lyric-line genius-bar ${player.connected ? "" : "is-disconnected"}`}
        >
          <strong>{player.name}</strong>
          <small>{player.connected ? "в игре" : "нет связи"}</small>
        </span>
      ))}
    </div>
  );
}

function HostLobby({
  state,
  code,
  send,
  status,
  error,
}: {
  state: PublicRoomState;
  code: RoomCode;
  send: (message: ClientMessage) => boolean;
  status: string;
  error: string | null;
}) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const copyLink = async (url: string, success: string) => {
    setManualLink(null);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else {
        const field = document.createElement("textarea");
        field.value = url;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand("copy");
        field.remove();
        if (!copied) throw new Error("Copy unavailable");
      }
      setCopyStatus(success);
    } catch {
      setCopyStatus("Выдели и скопируй ссылку ниже.");
      setManualLink(url);
    }
  };
  const connectedCount = state.players.filter((player) => player.connected).length;
  const canStart = connectedCount >= state.minPlayers;
  return (
    <main className="app-shell rules-screen-shell multiplayer-shell multiplayer-lobby-shell">
      <section className="rules-screen-card multiplayer-panel multiplayer-lobby">
        <StatusLine status={status} error={error} />
        <p className="multiplayer-eyebrow">Игроки заходят по коду</p>
        <h1 className="multiplayer-room-code">{code}</h1>
        <div className="multiplayer-join-card" aria-label="Ссылка для игроков">
          <span>Вход для игроков</span>
          <strong>{new URL(publicJoinUrl(code)).host}</strong>
          <a href={publicJoinUrl(code)} target="_blank" rel="noopener noreferrer">
            <small>{publicJoinUrl(code)}</small>
          </a>
          <button
            type="button"
            className="btn"
            onClick={() => void copyLink(publicJoinUrl(code), "Ссылка для игроков скопирована")}
          >
            Скопировать ссылку для игроков
          </button>
        </div>
        <PlayerRoster state={state} />
        <section className="multiplayer-room-settings" aria-label="Настройки комнаты">
          <button
            type="button"
            className="btn"
            onClick={() => {
              const url = `${publicGameOrigin()}${hostPath(code)}#screen=${getOrCreateHostToken(code)}`;
              void copyLink(url, "Ссылка восстановления скопирована");
            }}
          >
            Скопировать ссылку восстановления экрана
          </button>
        </section>
        {copyStatus ? (
          <p className="multiplayer-muted" role="status">
            {copyStatus}
          </p>
        ) : null}
        {manualLink ? (
          <label className="multiplayer-field">
            Ссылка для копирования
            <input readOnly value={manualLink} onFocus={(event) => event.currentTarget.select()} />
          </label>
        ) : null}
        <p className="multiplayer-muted">
          Игроков: {connectedCount}/{state.maxPlayers}. Викторина — от 2, фристайл — от 3. Максимум{" "}
          {state.maxPlayers}.
        </p>
        <button
          type="button"
          className="rules-screen-start-btn"
          aria-label="К выбору режима"
          title="К выбору режима"
          disabled={!canStart}
          onClick={() => send({ type: "host_start_mode_select" })}
        >
          →
        </button>
      </section>
    </main>
  );
}

function HostDock({ state }: { state: PublicRoomState }) {
  const waitingCount =
    state.phase === "quiz_answering"
      ? state.players.length - (state.quiz?.answeredPlayerIds.length ?? 0)
      : state.phase === "freestyle_submitting"
        ? state.players.length - (state.freestyle?.submittedPlayerIds.length ?? 0)
        : state.phase === "freestyle_voting"
          ? state.players.length - (state.freestyle?.votedPlayerIds.length ?? 0)
          : 0;
  const label =
    state.phase === "transition"
      ? "Готовим следующий раунд"
      : state.phase === "playing"
        ? "Слушаем фрагмент"
        : state.phase === "quiz_answering"
          ? `Игроки отвечают · осталось ${Math.max(0, waitingCount)}`
          : state.phase === "freestyle_submitting"
            ? `Игроки пишут продолжение · осталось ${Math.max(0, waitingCount)}`
            : state.phase === "freestyle_voting"
              ? `Голосование · осталось ${Math.max(0, waitingCount)}`
              : "Показываем результаты";
  return (
    <div className="dock-host">
      <p className="dock-pause-hint">{label}</p>
    </div>
  );
}

function FreestyleResultStage({ state }: { state: PublicRoomState }) {
  const result = state.roundResult?.kind === "freestyle" ? state.roundResult : null;
  if (!result) return null;
  return (
    <>
      <div className="multiplayer-result-section">
        <p className="multiplayer-eyebrow">Оригинальный бар</p>
        <p className="lyric-line genius-bar genius-reveal-line multiplayer-answer-bar">
          {result.originalAnswer}
        </p>
      </div>
      <div className="multiplayer-result-section">
        <h3>Ответы игроков</h3>
        <div className="multiplayer-submissions-list">
          {result.submissions.map((submission) => (
            <article
              key={submission.playerId}
              className={`lyric-line genius-bar multiplayer-submission-card ${
                submission.tieBrokenWinner ? "is-winner" : ""
              }`}
            >
              <span>{submission.text}</span>
              <small>
                {submission.name} · голосов {submission.votes}
                {submission.votingWinner ? " · победитель голосования" : ""}
                {submission.similarityBonus ? " · +1 похожесть" : ""}
              </small>
            </article>
          ))}
        </div>
        {result.tieBreakNote ? <p className="multiplayer-muted">{result.tieBreakNote}</p> : null}
      </div>
    </>
  );
}

function ResultOverlay({ state }: { state: PublicRoomState }) {
  if (!state.roundResult || state.phase !== "round_results") return null;
  return (
    <section className="multiplayer-round-summary" aria-live="polite">
      <header className="multiplayer-result-header">
        {state.roundResult.kind === "quiz" ? (
          <p className="multiplayer-muted">Верно: {state.roundResult.correctPlayerIds.length}</p>
        ) : (
          <p className="multiplayer-muted">Итоги фристайла</p>
        )}
        <CountdownPill label="Следующий раунд" targetAt={state.nextAdvanceAt} />
      </header>
      {state.roundResult.kind === "freestyle" ? <FreestyleResultStage state={state} /> : null}
    </section>
  );
}

function createPlayer(): PlayerAdapter {
  return new LocalMediaPlayer();
}

function useHostPlayback(state: PublicRoomState, send: (message: ClientMessage) => boolean) {
  const [visibleHintLineCount, setVisibleHintLineCount] = useState(0);
  const { seconds: timerSeconds } = useRoomTimer(state);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const playerRef = useRef<PlayerAdapter | null>(null);
  const snapshot = useRef(state);
  snapshot.current = state;
  const { phase, turnId, pausedAt } = state;
  const replayId = state.replay?.id ?? null;

  useEffect(() => () => playerRef.current?.destroy?.(), []);

  useEffect(() => {
    const current = snapshot.current;
    const round = current.round ?? roundById(current.currentRoundId);
    if (!round || pausedAt || (!replayId && !["playing", "round_results"].includes(phase))) {
      playerRef.current?.pause();
      if (phase === "transition") setVisibleHintLineCount(0);
      return;
    }
    let cancelled = false;
    let raf: number | undefined;
    const player = (playerRef.current ??= createPlayer());
    const start = async () => {
      if (
        current.code.startsWith("E2E") &&
        (import.meta.env.DEV || import.meta.env.VITE_PRIVATE_TESTING === "1")
      ) {
        if (phase === "playing" || replayId) {
          setVisibleHintLineCount(round.hintLineIds.length);
          send({ type: "host_media_ready", turnId, replayId: replayId ?? undefined });
        }
        return;
      }
      const source = toLocalMediaUrl(round);
      await player.load(
        attempt > 0 ? `${source}${source.includes("?") ? "&" : "?"}retry=${attempt}` : source,
      );
      if (cancelled) return;
      const startedAt = replayId ? current.replay?.startedAt : current.playingStartedAt;
      const elapsed = startedAt == null ? 0 : Math.max(0, (Date.now() - startedAt) / 1000);
      const stopAt = fragmentStopTimeSec(round.end);
      await player.seekToAsync(phase === "round_results" ? stopAt : Math.min(stopAt, round.start + elapsed));
      if (cancelled) return;
      player.setMuted(false);
      player.setVolume(1);
      await player.playAsync();
      if (cancelled) {
        player.pause();
        return;
      }
      setPlaybackError(null);
      if (phase === "round_results") return;
      send({ type: "host_media_ready", turnId, replayId: replayId ?? undefined });
      let lastTime = player.getCurrentTime();
      let lastProgressAt = Date.now();
      const monitor = () => {
        if (cancelled) return;
        const time = player.getCurrentTime();
        if (time > lastTime + 0.05) {
          lastTime = time;
          lastProgressAt = Date.now();
        }
        if (Date.now() - lastProgressAt > 5_000) {
          player.pause();
          send({ type: "host_media_failed", turnId });
          setPlaybackError("Музыка остановилась. Проверь подключение и нажми «Повторить».");
          return;
        }
        setVisibleHintLineCount(visibleHintCountAtTime(time, round, round.hintLineIds.length));
        if (time >= stopAt) {
          player.pause();
          player.seekTo(stopAt);
          return;
        }
        raf = requestAnimationFrame(monitor);
      };
      raf = requestAnimationFrame(monitor);
    };
    void start().catch(() => {
      if (!cancelled) {
        send({ type: "host_media_failed", turnId });
        setPlaybackError("Не удалось воспроизвести музыку. Проверь звук и нажми «Повторить».");
      }
    });
    return () => {
      cancelled = true;
      if (raf !== undefined) cancelAnimationFrame(raf);
      player.pause();
    };
    // A player joining, answering or sending a heartbeat must not restart audio.
  }, [phase, turnId, pausedAt, attempt, send, replayId]);

  return {
    visibleHintLineCount,
    timerSeconds,
    playbackError,
    retryPlayback: () => {
      playerRef.current?.destroy?.();
      playerRef.current = null;
      send({ type: "host_retry_media" });
      setAttempt((value) => value + 1);
    },
  };
}

function HostGame({ state, send }: { state: PublicRoomState; send: (message: ClientMessage) => boolean }) {
  const round = state.round ?? roundById(state.currentRoundId);
  const { timerSeconds, playbackError, retryPlayback } = useHostPlayback(state, send);
  const visibleHintLineCount = useSharedHintCount(state);
  const background = multiplayerRoundBackground({ ...state, round });
  if (!round) return <FinalLeaderboard state={state} send={send} />;

  const hintLines = pickLyricLines(round.lyrics, round.hintLineIds);
  const revealLines = pickLyricLines(round.lyrics, round.revealLineIds);
  const roundState: RoundState =
    state.phase === "transition"
      ? "transition"
      : state.phase === "playing"
        ? "playing"
        : state.phase === "round_results"
          ? "reveal"
          : "paused_for_guess";
  const { total: totalSeconds } = roomTimer(state);

  return (
    <main className="app-shell app-shell-quiz multiplayer-host-game">
      <QuizBackground
        photoUrl={background.photoUrl}
        youtubeSrc={background.youtubeSrc}
        videoSrc={background.videoSrc}
        videoStartSec={background.videoStartSec}
        synchronizedAt={state.backgroundStartedAt}
        synchronizedPausedAt={state.pausedAt}
      />
      <aside className="multiplayer-host-leaderboard">
        <Leaderboard rows={state.leaderboard} title="Игроки" state={state} />
      </aside>
      <DockChromaKeyLayer />
      <div className="app-overlay" key={state.currentRoundId ?? "none"}>
        <QuizScreen
          displayOnly
          timerShowsRemaining
          round={round}
          roundIndex={state.currentRoundIndex}
          totalRounds={state.totalRounds}
          roundState={roundState}
          gameMode={state.mode}
          quizScore={state.leaderboard[0]?.score ?? 0}
          quizOptions={state.quiz?.options ?? []}
          quizUiVariant={state.quiz?.variant ?? null}
          quizOrderUserIds={state.quiz?.orderLineIds ?? []}
          onReorderQuizOrder={() => {}}
          quizCorrectIndex={state.quiz?.correctIndex ?? -1}
          selectedQuizIndex={null}
          onSelectQuizOption={() => {}}
          hintLines={hintLines}
          revealLines={revealLines}
          visibleHintLineCount={visibleHintLineCount}
          timerSeconds={timerSeconds}
          totalSeconds={totalSeconds}
          gamePaused={!!state.pausedAt}
          onReplaySnippet={() => {}}
          onReveal={() => {}}
          onConfirmQuiz={() => {}}
          onNextRound={() => {}}
          controlsSlot={<HostDock state={state} />}
          resultSlot={<ResultOverlay state={state} />}
        />
      </div>
      {playbackError || (state.pausedAt && !state.manualPaused) ? (
        <aside className="multiplayer-toast" role="alert">
          <p>{playbackError ?? "Музыка не запустилась. Игра приостановлена."}</p>
          <button type="button" className="btn" onClick={retryPlayback}>
            Повторить
          </button>
        </aside>
      ) : null}
      <TransitionOverlay
        visible={state.phase === "transition"}
        nextRoundTitle={state.upcomingRoundTitle ?? ""}
      />
    </main>
  );
}

function FinalVotePanel({
  state,
  playerId,
  send,
  initial = false,
}: {
  initial?: boolean;
  state: PublicRoomState;
  playerId?: string;
  send?: (message: ClientMessage) => boolean;
}) {
  const vote = initial ? state.initialVote : state.finalVote;
  const decision = vote?.decision;
  const label = (mode: string) => (mode === "quiz" ? "Викторина" : "Фристайл");
  const selected = playerId ? vote?.votes[playerId] : undefined;
  const connectedCount = state.players.filter((player) => player.connected).length;
  return (
    <section className="multiplayer-final-vote" aria-label={initial ? "Выбор режима" : "Следующая игра"}>
      <h2>{initial ? "Выберите режим" : "Следующая игра"}</h2>
      {decision ? (
        <>
          <p role="status">
            {decision.random ? "Жеребьёвка" : "Выбрано большинством"}: {label(decision.mode)}
          </p>
          <CountdownPill label={initial ? "Правила через" : "Начало через"} targetAt={decision.startsAt} />
        </>
      ) : (
        <p className="multiplayer-muted">
          {connectedCount < 2
            ? `Нужно минимум 2 игрока. Пригласите участников по коду ${state.code}.`
            : "Выберите режим. При равенстве голосов — жеребьёвка."}
        </p>
      )}
      {!decision && connectedCount < 3 ? (
        <p className="multiplayer-muted">Викторина — от 2 игроков, фристайл — от 3.</p>
      ) : null}
      {playerId && send ? (
        <div className="multiplayer-final-actions">
          {(["quiz", "freestyle"] as const).map((mode) => (
            <button
              className="btn"
              type="button"
              key={mode}
              disabled={!!decision || connectedCount < minimumPlayersForMode(mode)}
              aria-pressed={selected === mode}
              onClick={() => send({ type: initial ? "player_mode_vote" : "player_final_vote", mode })}
            >
              {initial
                ? label(mode)
                : mode === state.mode
                  ? "Сыграть ещё"
                  : mode === "quiz"
                    ? "Перейти в викторину"
                    : "Перейти во фристайл"}
            </button>
          ))}
          {!initial ? (
            <button className="btn" type="button" onClick={() => send({ type: "player_leave" })}>
              Выйти из игры
            </button>
          ) : null}
        </div>
      ) : null}
      <ul className="multiplayer-final-voters">
        {state.players.map((player) => (
          <li key={player.id}>
            {player.name}:{" "}
            {!player.connected
              ? "нет связи"
              : vote?.votes[player.id]
                ? label(vote.votes[player.id])
                : "выбирает"}
          </li>
        ))}
      </ul>
    </section>
  );
}

function InitialModeVote({
  state,
  playerId,
  send,
}: {
  state: PublicRoomState;
  playerId?: string;
  send?: (message: ClientMessage) => boolean;
}) {
  return (
    <main className="app-shell rules-screen-shell multiplayer-shell">
      <section className="rules-screen-card multiplayer-panel multiplayer-controller-card">
        <p className="multiplayer-eyebrow">Комната {state.code}</p>
        <h1 className="rules-screen-title">Выбираем режим</h1>
        {!playerId ? <p className="multiplayer-muted">Игроки голосуют на своих устройствах.</p> : null}
        <FinalVotePanel state={state} playerId={playerId} send={send} initial />
      </section>
    </main>
  );
}

function FinalLeaderboard({ state }: { state: PublicRoomState; send?: (message: ClientMessage) => boolean }) {
  return (
    <main className="app-shell rules-screen-shell multiplayer-shell">
      <section className="rules-screen-card multiplayer-panel multiplayer-final-host">
        <Leaderboard rows={state.leaderboard} title="Итоги игры" finale />
        <FinalVotePanel state={state} />
        <p className="multiplayer-muted">Игроки выбирают следующую игру на своих устройствах.</p>
      </section>
    </main>
  );
}

function PlayerFinal({
  state,
  playerId,
  send,
}: {
  state: PublicRoomState;
  playerId: string;
  send: (message: ClientMessage) => boolean;
}) {
  const me = state.leaderboard.find((row) => row.playerId === playerId);
  const score = me?.score ?? 0;
  const winner = score > 0 && me?.rank === 1;
  const index = state.mode === "quiz" ? outroQuizVideoIndexForScore(score) : winner ? 4 : 0;
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const src = OUTRO_QUIZ_VIDEOS[index];
  useEffect(() => {
    setMuted(true);
    const el = video.current;
    if (el) {
      el.muted = true;
      void el.play().catch(() => setBlocked(true));
    }
  }, [src]);
  return (
    <main className="app-shell multiplayer-player-final">
      <video
        ref={video}
        className="multiplayer-personal-video"
        src={src}
        autoPlay
        playsInline
        muted={muted}
        loop
        onPlaying={() => setBlocked(false)}
      />
      <div className="multiplayer-personal-summary">
        <p className="multiplayer-eyebrow">
          {me?.name} · {state.mode === "quiz" ? "Викторина" : "Фристайл"}
        </p>
        <h1>
          {state.mode === "quiz"
            ? `Верных ответов: ${score} из ${state.totalRounds}`
            : winner
              ? "Победа"
              : "Поражение"}
        </h1>
        <p>
          Место: {me?.rank ?? "—"} · {score} очк.
        </p>
        <button
          className="btn"
          type="button"
          onClick={() => {
            const next = !muted;
            setMuted(next);
            if (video.current) {
              video.current.muted = next;
              void video.current.play().catch(() => setBlocked(true));
            }
          }}
        >
          {muted ? "Включить звук" : "Выключить звук"}
        </button>
        {blocked ? (
          <button className="btn" onClick={() => void video.current?.play().catch(() => setBlocked(true))}>
            Воспроизвести ролик
          </button>
        ) : null}
        <FinalVotePanel state={state} playerId={playerId} send={send} />
      </div>
    </main>
  );
}

export function MultiplayerHostApp({ code }: { code: RoomCode }) {
  if (code.length !== 6) return <InvalidRoomCodeScreen code={code} />;
  return <MultiplayerHostRoom code={code} />;
}

function MultiplayerHostRoom({ code }: { code: RoomCode }) {
  const room = usePartyRoom({ code, role: "host" });
  const state = room.state;
  let content: ReactNode;
  if (!room.admission.ticket) {
    content = <AdmissionPanel admission={room.admission} />;
  } else if (!state) {
    content = (
      <main className="app-shell rules-screen-shell multiplayer-shell">
        <section className="rules-screen-card multiplayer-panel">
          <StatusLine status={room.status} error={room.error} />
          <p>Создаём комнату…</p>
        </section>
      </main>
    );
  } else if (state.phase === "expired") {
    content = <RoomExpired />;
  } else if (state.phase === "lobby") {
    content = (
      <HostLobby state={state} code={code} send={room.send} status={room.status} error={room.error} />
    );
  } else if (state.phase === "mode_select") {
    content = <InitialModeVote state={state} />;
  } else if (state.phase === "rules" && state.mode) {
    content = (
      <RulesScreen
        multiplayer
        gameMode={state.mode}
        onBack={() => room.send({ type: "host_return_lobby" })}
        onComplete={() => room.send({ type: "host_start_game" })}
      />
    );
  } else if (state.phase === "finished") {
    content = <FinalLeaderboard state={state} send={room.send} />;
  } else {
    content = <HostGame state={state} send={room.send} />;
  }
  return (
    <>
      <RestoredToast visible={!!room.you?.reconnected} />
      <RoomMenu state={state} role="host" send={room.send} />
      {content}
    </>
  );
}

function PlayerJoin({ code, onJoin }: { code: RoomCode; onJoin: (name: string) => void }) {
  const [name, setName] = useState(getSavedPlayerName);
  const [roomCode, setRoomCode] = useState(code);
  const [error, setError] = useState<string | null>(code.length === 6 ? null : "Проверь код комнаты.");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleanCode = normalizeRoomCode(roomCode);
    if (cleanCode.length !== 6) {
      setError("Код комнаты состоит из 6 символов.");
      return;
    }
    if (cleanCode !== code) {
      window.location.href = playerPath(cleanCode);
      return;
    }
    const clean = name.trim();
    if (!clean) return;
    rememberPlayerName(clean);
    onJoin(clean);
  };
  return (
    <main className="app-shell rules-screen-shell multiplayer-shell">
      <form
        className="rules-screen-card multiplayer-panel multiplayer-controller multiplayer-controller-card"
        onSubmit={submit}
      >
        <p className="multiplayer-eyebrow">Контроллер игрока</p>
        <h1 className="rules-screen-title">Войти в игру</h1>
        <label className="multiplayer-field multiplayer-code-field">
          Код комнаты
          <input
            value={roomCode}
            onChange={(event) => {
              setError(null);
              setRoomCode(normalizeRoomCode(event.target.value));
            }}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="multiplayer-field">
          Имя
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={24} autoFocus />
        </label>
        {error ? (
          <p className="multiplayer-status multiplayer-status--error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="rules-screen-start-wrap">
          <button type="submit" className="rules-screen-start-btn" aria-label="Играть" title="Играть">
            →
          </button>
        </div>
      </form>
    </main>
  );
}

function PlayerWaiting({
  state,
  title,
  playerId,
  acceptedText,
  own,
}: {
  state: PublicRoomState;
  title: string;
  playerId?: string;
  acceptedText?: string | null;
  own?: PrivatePlayerState;
}) {
  const me = state.players.find((player) => player.id === playerId);
  const timer = useRoomTimer(state);
  const visible = useSharedHintCount(state);
  const listeningRound = state.round ?? roundById(state.currentRoundId);
  const { containerRef, innerRef } = useQuizContentFit(
    `${state.turnId}:${state.phase}:${own?.quizAnswer ? JSON.stringify(own.quizAnswer) : ""}:${own?.submission}:${own?.votedSubmissionId}`,
  );
  return (
    <MultiplayerScene state={state}>
      <div className="quiz-screen multiplayer-waiting-screen">
        <header className="quiz-header">
          <span className="quiz-round-counter">
            {me?.name ?? "Игрок"} · {state.code}{" "}
            {state.totalRounds > 0
              ? ` · ${Math.min(state.currentRoundIndex + 1, state.totalRounds)}/${state.totalRounds} · ${me?.score ?? 0} очк.`
              : ""}
          </span>
          {state.totalRounds > 0 && state.phase !== "round_results" ? (
            <div className="quiz-header-timer">
              <Timer
                remaining
                seconds={timer.seconds}
                totalSeconds={timer.total}
                isActive={!!state.deadlineAt && !state.pausedAt}
              />
            </div>
          ) : null}
        </header>
        <div className="quiz-content">
          <div ref={containerRef} className="quiz-content-fit-outer">
            <div ref={innerRef} className="quiz-content-fit-inner">
              <div className="multiplayer-waiting-content">
                <h1 className="quiz-title">{title}</h1>
                {(state.phase === "playing" || state.replay) && listeningRound ? (
                  <LyricsPanel
                    hintLines={pickLyricLines(listeningRound.lyrics, listeningRound.hintLineIds)}
                    visibleCount={visible}
                  />
                ) : null}
                {acceptedText ? (
                  <p className="lyric-line genius-bar genius-reveal-line multiplayer-answer-bar">
                    {acceptedText}
                  </p>
                ) : null}
                {state.totalRounds > 0 ? (
                  <PlayerRoundInformation state={state} playerId={playerId} own={own} />
                ) : (
                  <p className="multiplayer-muted">Музыка — на общем экране. Ответы — здесь.</p>
                )}
                <RoundProgress state={state} />
              </div>
            </div>
          </div>
        </div>
        <div className="dock-host">
          <p className="dock-pause-hint">
            {state.pausedAt
              ? state.manualPaused
                ? "Игра продолжится по команде ведущего"
                : "Игра продолжится после подключения общего экрана"
              : "Следующий этап начнётся автоматически"}
          </p>
        </div>
      </div>
    </MultiplayerScene>
  );
}

function PlayerQuizController({
  state,
  playerId,
  send,
  own,
}: {
  state: PublicRoomState;
  playerId: string;
  send: (message: ClientMessage) => boolean;
  own?: PrivatePlayerState;
}) {
  const round = state.round ?? roundById(state.currentRoundId);
  const [selection, setSelection] = useState<{ turn: string; index: number | null; order: number[] }>({
    turn: state.turnId,
    index: null,
    order: state.quiz?.orderLineIds ?? [],
  });
  const current =
    selection.turn === state.turnId
      ? selection
      : { turn: state.turnId, index: null, order: state.quiz?.orderLineIds ?? [] };
  const { seconds, total } = useRoomTimer(state);
  const visibleHintLineCount = useSharedHintCount(state);
  const accepted = state.quiz?.answeredPlayerIds.includes(playerId) ?? false;
  const acceptedIndex = own?.quizAnswer?.variant === "mc4" ? own.quizAnswer.selectedIndex : current.index;
  const canSubmit = state.quiz?.variant === "order" || current.index !== null;
  const confirm = () => {
    if (!canSubmit || !state.quiz || accepted) return;
    const answer =
      state.quiz.variant === "order"
        ? { variant: "order" as const, orderIds: current.order }
        : { variant: "mc4" as const, selectedIndex: current.index! };
    send({ type: "player_quiz_answer", turnId: state.turnId, answer });
  };
  if (!round || !state.quiz)
    return <PlayerWaiting state={state} playerId={playerId} title="Готовим вопрос" own={own} />;
  return (
    <MultiplayerScene state={state}>
      <QuizScreen
        round={round}
        roundIndex={state.currentRoundIndex}
        totalRounds={state.totalRounds}
        timerShowsRemaining
        roundState="paused_for_guess"
        gameMode="quiz"
        quizScore={state.players.find((player) => player.id === playerId)?.score ?? 0}
        quizOptions={state.quiz.options}
        quizUiVariant={state.quiz.variant}
        quizOrderUserIds={current.order}
        onReorderQuizOrder={(order) => setSelection({ ...current, order })}
        quizCorrectIndex={-1}
        selectedQuizIndex={accepted ? acceptedIndex : current.index}
        onSelectQuizOption={(index) => setSelection({ ...current, index })}
        hintLines={pickLyricLines(round.lyrics, round.hintLineIds)}
        revealLines={[]}
        visibleHintLineCount={visibleHintLineCount}
        timerSeconds={seconds}
        totalSeconds={total}
        gamePaused={accepted || !!state.pausedAt}
        onReplaySnippet={() => {}}
        onReveal={() => {}}
        onConfirmQuiz={confirm}
        onNextRound={() => {}}
        controlsSlot={
          <div className="dock-host">
            <p className="dock-pause-hint">
              {accepted
                ? "Ответ принят"
                : state.quiz.variant === "order"
                  ? "Расставьте строки и подтвердите ответ"
                  : "Выберите вариант и подтвердите ответ"}
            </p>
            <RoundProgress state={state} />
            <nav className="dock" aria-label="Ответ">
              <ReplayButton state={state} playerId={playerId} send={send} />
              <button
                className="dock-btn dock-btn-primary"
                type="button"
                disabled={!canSubmit || accepted || !!state.pausedAt}
                onClick={confirm}
                aria-label="Подтвердить ответ"
              >
                ✓
              </button>
            </nav>
          </div>
        }
      />
    </MultiplayerScene>
  );
}

function PlayerStageHeader({ state, playerId }: { state: PublicRoomState; playerId: string }) {
  const me = state.players.find((player) => player.id === playerId);
  const { seconds, total } = useRoomTimer(state);
  return (
    <header className="quiz-header">
      <span className="quiz-round-counter">
        {state.currentRoundIndex + 1}/{state.totalRounds} · {me?.name} · {me?.score ?? 0} очк.
      </span>
      <div className="quiz-header-timer">
        <Timer
          remaining
          seconds={seconds}
          isActive={!state.pausedAt && !!state.deadlineAt}
          totalSeconds={total}
        />
      </div>
    </header>
  );
}

function PlayerFreestyleSubmit({
  state,
  playerId,
  send,
  acceptedText,
  onAcceptedText,
}: {
  state: PublicRoomState;
  playerId: string;
  send: (message: ClientMessage) => boolean;
  acceptedText: string | null;
  onAcceptedText: (text: string) => void;
}) {
  const round = state.round ?? roundById(state.currentRoundId);
  const hintLines = round ? pickLyricLines(round.lyrics, round.hintLineIds) : [];
  const [text, setText] = useState("");
  const visible = useSharedHintCount(state);
  if (state.freestyle?.submittedPlayerIds.includes(playerId))
    return (
      <PlayerWaiting
        state={state}
        playerId={playerId}
        title="Ответ отправлен"
        own={{ quizAnswer: null, submission: acceptedText, votedSubmissionId: null }}
      />
    );
  return (
    <MultiplayerScene state={state}>
      <div className="quiz-screen">
        <PlayerStageHeader state={state} playerId={playerId} />
        <section className="quiz-content multiplayer-controller-content">
          <h1 className="quiz-title">Продолжи текст</h1>
          <RoundProgress state={state} />
          <LyricsPanel hintLines={hintLines} visibleCount={visible} />
          <textarea
            className="multiplayer-textarea"
            disabled={!!state.pausedAt}
            value={text}
            onChange={(event) => setText(event.target.value)}
            autoFocus
          />
          <div className="dock-host">
            <nav className="dock" aria-label="Ответ">
              <ReplayButton state={state} playerId={playerId} send={send} />
              <button
                type="button"
                aria-label="Отправить"
                title="Отправить"
                className="dock-btn dock-btn-primary"
                disabled={!text.trim() || !!state.pausedAt}
                onClick={() => {
                  const clean = text.trim();
                  if (!clean) return;
                  onAcceptedText(clean);
                  send({ type: "player_freestyle_submit", turnId: state.turnId, text: clean });
                }}
              >
                ✓
              </button>
            </nav>
          </div>
        </section>
      </div>
    </MultiplayerScene>
  );
}

function PlayerVote({
  state,
  playerId,
  send,
  own,
}: {
  state: PublicRoomState;
  playerId: string;
  send: (message: ClientMessage) => boolean;
  own?: PrivatePlayerState;
}) {
  if (state.freestyle?.votedPlayerIds.includes(playerId))
    return <PlayerWaiting state={state} playerId={playerId} title="Голос принят" own={own} />;
  const options = (state.freestyle?.votingOptions ?? []).filter((option) => option.submissionId !== playerId);
  return (
    <MultiplayerScene state={state}>
      <div className="quiz-screen">
        <PlayerStageHeader state={state} playerId={playerId} />
        <section className="quiz-content multiplayer-controller-content">
          <h1 className="quiz-title">Голосование</h1>
          <RoundProgress state={state} />
          <p className="multiplayer-muted">Один голос. За свой бар голосовать нельзя.</p>
          <div className="multiplayer-answer-grid quiz-options-grid">
            {options.map((option) => (
              <button
                key={option.submissionId}
                type="button"
                disabled={!!state.pausedAt}
                className="lyric-line genius-bar quiz-option"
                onClick={() =>
                  send({ type: "player_vote", turnId: state.turnId, submissionId: option.submissionId })
                }
              >
                {option.text}
              </button>
            ))}
          </div>
        </section>
      </div>
    </MultiplayerScene>
  );
}

export function MultiplayerPlayerApp({ code }: { code: RoomCode }) {
  if (code.length !== 6) return <InvalidRoomCodeScreen code={code} />;
  return <MultiplayerPlayerRoom code={code} />;
}

function MultiplayerPlayerRoom({ code }: { code: RoomCode }) {
  const [name, setName] = useState(getSavedPlayerName);
  const room = usePartyRoom({ code, role: "player", playerName: name, enabled: !!name });
  useEffect(() => {
    if (room.left) {
      forgetRoom();
      window.location.href = "/#menu";
    }
  }, [room.left]);
  if (!name)
    return (
      <>
        <RoomMenu state={null} role="player" send={room.send} />
        <PlayerJoin code={code} onJoin={setName} />
      </>
    );
  const state = room.state;
  const playerId = room.you?.playerId;
  const own = room.you?.own;
  let content: ReactNode;
  if (!room.admission.ticket) {
    content = <AdmissionPanel admission={room.admission} />;
  } else if (state?.phase === "expired") {
    content = <RoomExpired />;
  } else if (!state || !playerId) {
    content = (
      <main className="app-shell rules-screen-shell multiplayer-shell">
        <section className="rules-screen-card multiplayer-panel multiplayer-controller multiplayer-controller-card">
          <StatusLine status={room.status} error={room.error} />
          <h1 className="rules-screen-title">Восстанавливаем сессию…</h1>
        </section>
      </main>
    );
  } else if (
    state.pausedAt &&
    !["quiz_answering", "freestyle_submitting", "freestyle_voting"].includes(state.phase)
  ) {
    content = (
      <PlayerWaiting
        state={state}
        playerId={playerId}
        title={state.manualPaused ? "Ведущий поставил игру на паузу" : "Пауза — ждём главный экран"}
        own={own}
      />
    );
  } else if (state.phase === "mode_select") {
    content = <InitialModeVote state={state} playerId={playerId} send={room.send} />;
  } else if (state.phase === "quiz_answering") {
    content = <PlayerQuizController state={state} playerId={playerId} send={room.send} own={own} />;
  } else if (state.phase === "freestyle_submitting") {
    content = (
      <PlayerFreestyleSubmit
        state={state}
        playerId={playerId}
        send={room.send}
        acceptedText={own?.submission ?? null}
        onAcceptedText={() => {}}
      />
    );
  } else if (state.phase === "freestyle_voting") {
    content = <PlayerVote state={state} playerId={playerId} send={room.send} own={own} />;
  } else if (state.phase === "round_results") {
    content = <PlayerWaiting state={state} playerId={playerId} title="Итоги раунда" own={own} />;
  } else if (state.phase === "finished") {
    content = <PlayerFinal state={state} playerId={playerId} send={room.send} />;
  } else {
    content = (
      <PlayerWaiting
        state={state}
        playerId={playerId}
        title={
          state.phase === "playing"
            ? "Слушаем фрагмент"
            : state.phase === "transition"
              ? "Следующий раунд"
              : "Ждём ведущий экран"
        }
        own={own}
      />
    );
  }
  return (
    <>
      <RestoredToast visible={!!room.you?.reconnected} />
      <RoomMenu state={state} role="player" send={room.send} />
      {content}
    </>
  );
}

function RoomExpired() {
  return (
    <main className="app-shell rules-screen-shell multiplayer-shell">
      <section className="rules-screen-card multiplayer-panel">
        <h1 className="rules-screen-title">Комната закрыта</h1>
        <p>Время восстановления истекло. Создай новую комнату.</p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            window.location.href = "/";
          }}
        >
          На старт
        </button>
      </section>
    </main>
  );
}

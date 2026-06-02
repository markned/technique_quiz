import { FormEvent, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ClientMessage } from "./messages";
import type { LeaderboardRow, PublicRoomState, RoomCode } from "./types";
import { usePartyRoom } from "./usePartyRoom";
import { getSavedPlayerName, normalizeRoomCode, rememberPlayerName } from "./identity";
import { playerPath, publicJoinUrl } from "./routes";
import { roundById } from "./rounds";
import { buildQuizEligiblePool } from "../helpers/quizMode";
import { visibleRoundsForSession } from "../helpers/sessionRounds";
import { pickLyricLines } from "../helpers/lyrics";
import { fragmentStopTimeSec, getGuessSeconds } from "../helpers/quizConfig";
import { visibleHintCountAtTime } from "../helpers/quizPlayback";
import { toLocalMediaUrl } from "../helpers/media";
import { LocalMediaPlayer } from "../adapters/localMediaPlayer";
import type { PlayerAdapter } from "../adapters/player";
import type { RoundState } from "../types";
import { QuizBackground } from "../components/QuizBackground";
import { DockChromaKeyLayer } from "../components/DockChromaKeyLayer";
import { ModeSelectScreen } from "../components/ModeSelectScreen";
import { RulesScreen } from "../components/RulesScreen";
import { QuizScreen } from "../components/QuizScreen";
import { TransitionOverlay } from "../components/TransitionOverlay";
import { buildRoundPhotoFilenameSequence, resolveRoundBackgroundSources } from "../helpers/roundBackground";

function StatusLine({ status, error }: { status: string; error: string | null }) {
  if (error) return <p className="multiplayer-status multiplayer-status--error">{error}</p>;
  if (status !== "connected") {
    return <p className="multiplayer-status">Восстанавливаем подключение…</p>;
  }
  return null;
}

function RestoredToast({ visible }: { visible: boolean }) {
  return visible ? (
    <div className="multiplayer-toast" role="status">
      Сессия восстановлена
    </div>
  ) : null;
}

function InvalidRoomCodeScreen({ code }: { code: RoomCode }) {
  return (
    <main className="app-shell multiplayer-shell">
      <section className="multiplayer-panel multiplayer-controller-card">
        <p className="multiplayer-eyebrow">Комната</p>
        <h1>Неверный код</h1>
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
}: {
  rows: LeaderboardRow[];
  title?: string;
  finale?: boolean;
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
          <small>{player.connected ? "online" : "reconnect"}</small>
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
  const connectedCount = state.players.filter((player) => player.connected).length;
  const canStart = connectedCount >= state.minPlayers;
  return (
    <main className="app-shell multiplayer-shell multiplayer-lobby-shell">
      <section className="multiplayer-panel multiplayer-lobby">
        <StatusLine status={status} error={error} />
        <p className="multiplayer-eyebrow">Игроки заходят по коду</p>
        <h1 className="multiplayer-room-code">{code}</h1>
        <div className="multiplayer-join-card" aria-label="Ссылка для игроков">
          <span>Join at</span>
          <strong>{window.location.host}</strong>
          <small>{publicJoinUrl(code)}</small>
        </div>
        <PlayerRoster state={state} />
        <p className="multiplayer-muted">
          Игроков online: {connectedCount}/{state.maxPlayers}. Нужно минимум {state.minPlayers}, максимум{" "}
          {state.maxPlayers}.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-hero"
          disabled={!canStart}
          onClick={() => send({ type: "host_start_mode_select" })}
        >
          К выбору режима
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
    state.phase === "playing"
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

function QuizResultStage({ state }: { state: PublicRoomState }) {
  const result = state.roundResult?.kind === "quiz" ? state.roundResult : null;
  if (!result) return null;
  const correctIds = new Set(result.correctPlayerIds);
  const correct = result.playerResults.filter((item) => correctIds.has(item.playerId));
  const missed = result.playerResults.filter((item) => !correctIds.has(item.playerId));
  return (
    <>
      <div className="multiplayer-result-section">
        <p className="multiplayer-eyebrow">Правильный ответ</p>
        <p className="lyric-line genius-bar genius-reveal-line multiplayer-answer-bar">
          {result.correctAnswer}
        </p>
        <p className="multiplayer-muted">Верно: {correct.length}</p>
      </div>
      <div className="multiplayer-result-columns">
        <section>
          <h3>Попали</h3>
          <div className="multiplayer-result-bars">
            {correct.length > 0 ? (
              correct.map((item) => (
                <p key={item.playerId} className="lyric-line genius-bar multiplayer-result-player is-correct">
                  {item.name}
                </p>
              ))
            ) : (
              <p className="multiplayer-muted">В этом раунде никто.</p>
            )}
          </div>
        </section>
        <section>
          <h3>Мимо / нет ответа</h3>
          <div className="multiplayer-result-bars">
            {missed.map((item) => (
              <p key={item.playerId} className="lyric-line genius-bar multiplayer-result-player is-missed">
                {item.name}
                <small>{item.answerLabel}</small>
              </p>
            ))}
          </div>
        </section>
      </div>
    </>
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
  if (!state.roundResult && state.phase !== "finished") return null;
  if (state.phase === "finished") return null;
  return (
    <aside className="multiplayer-result-overlay" aria-live="polite">
      <section className="multiplayer-result-stage">
        <header className="multiplayer-result-header">
          <p className="multiplayer-eyebrow">Раунд {state.currentRoundIndex + 1}</p>
          <h2>{state.roundResult?.kind === "freestyle" ? "Итоги фристайла" : "Итоги викторины"}</h2>
          <CountdownPill label="Следующий раунд" targetAt={state.nextAdvanceAt} />
        </header>
        {state.roundResult?.kind === "quiz" ? <QuizResultStage state={state} /> : null}
        {state.roundResult?.kind === "freestyle" ? <FreestyleResultStage state={state} /> : null}
        <Leaderboard rows={state.leaderboard} title="Лидерборд" />
      </section>
    </aside>
  );
}

function createPlayer(): PlayerAdapter {
  return new LocalMediaPlayer();
}

function useHostPlayback(state: PublicRoomState | null, send: (message: ClientMessage) => boolean) {
  const [visibleHintLineCount, setVisibleHintLineCount] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const playerRef = useRef<PlayerAdapter | null>(null);
  const rafRef = useRef<number | null>(null);
  const playKeyRef = useRef("");
  const revealKeyRef = useRef("");
  const checkpointKeyRef = useRef("");

  const round = roundById(state?.currentRoundId ?? null);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      playerRef.current?.destroy?.();
    };
  }, []);

  useEffect(() => {
    if (!state?.deadlineAt) {
      setTimerSeconds(0);
      return undefined;
    }
    const tick = () => setTimerSeconds(Math.max(0, Math.ceil((state.deadlineAt! - Date.now()) / 1_000)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [state?.deadlineAt]);

  useEffect(() => {
    if (!state || !round) return;
    if (state.phase === "transition") setVisibleHintLineCount(0);
    if (state.phase !== "playing") return;
    const key = `${state.currentRoundId}:${state.currentRoundIndex}`;
    if (playKeyRef.current === key) return;
    playKeyRef.current = key;
    checkpointKeyRef.current = "";
    if (state.code.startsWith("E2E")) {
      setVisibleHintLineCount(round.hintLineIds.length);
      window.setTimeout(() => {
        if (checkpointKeyRef.current !== key) {
          checkpointKeyRef.current = key;
          send({ type: "host_media_checkpoint", checkpoint: "fragment_stopped", roundId: round.id });
        }
      }, 250);
      return;
    }
    let cancelled = false;
    const start = async () => {
      const player = (playerRef.current ??= createPlayer());
      await player.load(toLocalMediaUrl(round));
      await player.seekToAsync(round.start);
      player.setMuted(false);
      player.setVolume(1);
      try {
        await player.playAsync();
      } catch {
        void player.play();
      }
      const monitor = () => {
        if (cancelled) return;
        const time = player.getCurrentTime();
        setVisibleHintLineCount(Math.max(visibleHintCountAtTime(time, round, round.hintLineIds.length), 0));
        const stopAt = fragmentStopTimeSec(round.end);
        if (time >= stopAt) {
          player.pause();
          player.seekTo(stopAt);
          if (checkpointKeyRef.current !== key) {
            checkpointKeyRef.current = key;
            send({ type: "host_media_checkpoint", checkpoint: "fragment_stopped", roundId: round.id });
          }
          return;
        }
        rafRef.current = requestAnimationFrame(monitor);
      };
      rafRef.current = requestAnimationFrame(monitor);
    };
    void start();
    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [round, send, state]);

  useEffect(() => {
    if (!state || !round || state.phase !== "round_results") return;
    const key = `${state.currentRoundId}:${state.currentRoundIndex}:reveal`;
    if (revealKeyRef.current === key) return;
    revealKeyRef.current = key;
    const player = (playerRef.current ??= createPlayer());
    player.seekTo(fragmentStopTimeSec(round.end));
    player.setMuted(false);
    player.setVolume(1);
    player.play();
  }, [round, state]);

  return {
    visibleHintLineCount,
    timerSeconds,
  };
}

function HostGame({ state, send }: { state: PublicRoomState; send: (message: ClientMessage) => boolean }) {
  const round = roundById(state.currentRoundId);
  const { visibleHintLineCount, timerSeconds } = useHostPlayback(state, send);
  const photoSequence = useMemo(
    () => buildRoundPhotoFilenameSequence(state.totalRounds),
    [state.totalRounds],
  );
  const background = resolveRoundBackgroundSources(round, photoSequence[state.currentRoundIndex]);
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
  const totalSeconds = getGuessSeconds(state.quiz?.answerLineCount ?? revealLines.length);

  return (
    <main className="app-shell app-shell-quiz">
      <QuizBackground
        photoUrl={background.photoUrl}
        youtubeSrc={background.youtubeSrc}
        videoSrc={background.videoSrc}
        videoStartSec={background.videoStartSec}
      />
      <DockChromaKeyLayer />
      <div className="app-overlay" key={state.currentRoundId ?? "none"}>
        <QuizScreen
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
          gamePaused={false}
          onReplaySnippet={() => {}}
          onReveal={() => {}}
          onConfirmQuiz={() => {}}
          onNextRound={() => {}}
          controlsSlot={<HostDock state={state} />}
        />
      </div>
      <ResultOverlay state={state} />
      <TransitionOverlay
        visible={state.phase === "transition"}
        nextRoundTitle={state.upcomingRoundTitle ?? ""}
      />
    </main>
  );
}

function FinalLeaderboard({
  state,
  send,
}: {
  state: PublicRoomState;
  send: (message: ClientMessage) => boolean;
}) {
  return (
    <main className="app-shell multiplayer-shell multiplayer-finale-shell">
      <section className="multiplayer-result-stage multiplayer-finale-stage">
        <p className="multiplayer-eyebrow">Финал</p>
        <h1>Победители</h1>
        <Leaderboard rows={state.leaderboard} title="Финальный лидерборд" finale />
        <button
          type="button"
          className="btn btn-primary btn-hero"
          onClick={() => send({ type: "host_restart_game" })}
        >
          Сыграть ещё
        </button>
      </section>
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
  if (!state) {
    content = (
      <main className="app-shell multiplayer-shell">
        <section className="multiplayer-panel">
          <StatusLine status={room.status} error={room.error} />
          <p>Создаём комнату…</p>
        </section>
      </main>
    );
  } else if (state.phase === "lobby") {
    content = (
      <HostLobby state={state} code={code} send={room.send} status={room.status} error={room.error} />
    );
  } else if (state.phase === "mode_select") {
    content = (
      <ModeSelectScreen
        quizEligibleCount={buildQuizEligiblePool(visibleRoundsForSession()).length}
        onSelectMode={(mode) => room.send({ type: "host_select_mode", mode })}
      />
    );
  } else if (state.phase === "rules" && state.mode) {
    content = <RulesScreen gameMode={state.mode} onComplete={() => room.send({ type: "host_start_game" })} />;
  } else if (state.phase === "finished") {
    content = <FinalLeaderboard state={state} send={room.send} />;
  } else {
    content = <HostGame state={state} send={room.send} />;
  }
  return (
    <>
      <RestoredToast visible={!!room.you?.reconnected} />
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
    <main className="app-shell multiplayer-shell">
      <form
        className="multiplayer-panel multiplayer-controller multiplayer-controller-card"
        onSubmit={submit}
      >
        <p className="multiplayer-eyebrow">Контроллер игрока</p>
        <h1>Войти в игру</h1>
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
        <button type="submit" className="btn btn-primary btn-hero">
          Играть
        </button>
      </form>
    </main>
  );
}

function PlayerWaiting({
  state,
  title,
  playerId,
  acceptedText,
}: {
  state: PublicRoomState;
  title: string;
  playerId?: string;
  acceptedText?: string | null;
}) {
  const me = playerId ? state.players.find((player) => player.id === playerId) : null;
  return (
    <main className="app-shell multiplayer-shell">
      <section className="multiplayer-panel multiplayer-controller multiplayer-controller-card">
        <p className="multiplayer-eyebrow">Комната {state.code}</p>
        <h1>{title}</h1>
        {me ? (
          <p className="lyric-line genius-bar multiplayer-controller-identity">
            {me.name}
            <small>{me.connected ? "подключён" : "переподключаем"}</small>
          </p>
        ) : null}
        {acceptedText ? (
          <p className="lyric-line genius-bar genius-reveal-line multiplayer-answer-bar">{acceptedText}</p>
        ) : null}
        <p className="multiplayer-muted">Смотри на главный экран — там музыка, таймер и результаты.</p>
        <Leaderboard rows={state.leaderboard} />
      </section>
    </main>
  );
}

function PlayerQuizController({
  state,
  playerId,
  send,
}: {
  state: PublicRoomState;
  playerId: string;
  send: (message: ClientMessage) => boolean;
}) {
  const round = roundById(state.currentRoundId);
  const alreadyAnswered = state.quiz?.answeredPlayerIds.includes(playerId);
  const defaultOrder = state.quiz?.orderLineIds ?? [];
  const [orderState, setOrderState] = useState<{ roundId: number | null; ids: number[] }>(() => ({
    roundId: state.currentRoundId,
    ids: defaultOrder,
  }));
  const order = orderState.roundId === state.currentRoundId ? orderState.ids : defaultOrder;
  if (!state.quiz || alreadyAnswered)
    return <PlayerWaiting state={state} playerId={playerId} title="Ответ принят" />;
  if (state.quiz.variant === "mc4") {
    return (
      <main className="app-shell multiplayer-shell">
        <section className="multiplayer-panel multiplayer-controller multiplayer-controller-card">
          <p className="multiplayer-eyebrow">Комната {state.code}</p>
          <h1>Выбери ответ</h1>
          <CountdownPill label="Осталось" targetAt={state.deadlineAt} />
          <div className="multiplayer-answer-grid">
            {state.quiz.options.map((option, index) => (
              <button
                key={option}
                type="button"
                className="lyric-line genius-bar quiz-option"
                onClick={() =>
                  send({ type: "player_quiz_answer", answer: { variant: "mc4", selectedIndex: index } })
                }
              >
                {option}
              </button>
            ))}
          </div>
        </section>
      </main>
    );
  }
  const lineText = (id: number) => round?.lyrics.find((line) => line.id === id)?.text ?? "—";
  const move = (from: number, to: number) => {
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setOrderState({ roundId: state.currentRoundId, ids: next });
  };
  return (
    <main className="app-shell multiplayer-shell">
      <section className="multiplayer-panel multiplayer-controller multiplayer-controller-card">
        <p className="multiplayer-eyebrow">Комната {state.code}</p>
        <h1>Собери порядок</h1>
        <CountdownPill label="Осталось" targetAt={state.deadlineAt} />
        <ol className="multiplayer-order-list">
          {order.map((id, index) => (
            <li key={id}>
              <span className="lyric-line genius-bar quiz-option">{lineText(id)}</span>
              <button type="button" disabled={index === 0} onClick={() => move(index, index - 1)}>
                ↑
              </button>
              <button
                type="button"
                disabled={index === order.length - 1}
                onClick={() => move(index, index + 1)}
              >
                ↓
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="btn btn-primary btn-hero"
          onClick={() => send({ type: "player_quiz_answer", answer: { variant: "order", orderIds: order } })}
        >
          Ответить
        </button>
      </section>
    </main>
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
  const round = roundById(state.currentRoundId);
  const hintLines = round ? pickLyricLines(round.lyrics, round.hintLineIds) : [];
  const [text, setText] = useState("");
  if (state.freestyle?.submittedPlayerIds.includes(playerId))
    return (
      <PlayerWaiting state={state} playerId={playerId} title="Ответ отправлен" acceptedText={acceptedText} />
    );
  return (
    <main className="app-shell multiplayer-shell">
      <section className="multiplayer-panel multiplayer-controller multiplayer-controller-card">
        <p className="multiplayer-eyebrow">Комната {state.code}</p>
        <h1>Продолжи текст</h1>
        <CountdownPill label="Осталось" targetAt={state.deadlineAt} />
        {hintLines.length > 0 ? (
          <div className="multiplayer-hint-bars">
            {hintLines.map((line) => (
              <p key={line.id} className="lyric-line genius-bar">
                {line.text}
              </p>
            ))}
          </div>
        ) : null}
        <textarea
          className="multiplayer-textarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          autoFocus
        />
        <button
          type="button"
          className="btn btn-primary btn-hero"
          disabled={!text.trim()}
          onClick={() => {
            const clean = text.trim();
            if (!clean) return;
            onAcceptedText(clean);
            send({ type: "player_freestyle_submit", text: clean });
          }}
        >
          Отправить
        </button>
      </section>
    </main>
  );
}

function PlayerVote({
  state,
  playerId,
  send,
}: {
  state: PublicRoomState;
  playerId: string;
  send: (message: ClientMessage) => boolean;
}) {
  if (state.freestyle?.votedPlayerIds.includes(playerId))
    return <PlayerWaiting state={state} playerId={playerId} title="Голос принят" />;
  const options = (state.freestyle?.votingOptions ?? []).filter((option) => option.submissionId !== playerId);
  return (
    <main className="app-shell multiplayer-shell">
      <section className="multiplayer-panel multiplayer-controller multiplayer-controller-card">
        <p className="multiplayer-eyebrow">Комната {state.code}</p>
        <h1>Голосование</h1>
        <p className="multiplayer-muted">Один голос. За свой бар голосовать нельзя.</p>
        <CountdownPill label="Осталось" targetAt={state.deadlineAt} />
        <div className="multiplayer-answer-grid">
          {options.map((option) => (
            <button
              key={option.submissionId}
              type="button"
              className="lyric-line genius-bar quiz-option"
              onClick={() => send({ type: "player_vote", submissionId: option.submissionId })}
            >
              {option.text}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

export function MultiplayerPlayerApp({ code }: { code: RoomCode }) {
  if (code.length !== 6) return <InvalidRoomCodeScreen code={code} />;
  return <MultiplayerPlayerRoom code={code} />;
}

function MultiplayerPlayerRoom({ code }: { code: RoomCode }) {
  const [name, setName] = useState(getSavedPlayerName);
  const [acceptedSubmissions, setAcceptedSubmissions] = useState<Record<string, string>>({});
  const room = usePartyRoom({ code, role: "player", playerName: name, enabled: !!name });
  if (!name) return <PlayerJoin code={code} onJoin={setName} />;
  const state = room.state;
  const playerId = room.you?.playerId;
  const submissionKey = state?.currentRoundId ? String(state.currentRoundId) : "";
  let content: ReactNode;
  if (!state || !playerId) {
    content = (
      <main className="app-shell multiplayer-shell">
        <section className="multiplayer-panel multiplayer-controller multiplayer-controller-card">
          <StatusLine status={room.status} error={room.error} />
          <h1>Восстанавливаем сессию…</h1>
        </section>
      </main>
    );
  } else if (state.phase === "quiz_answering") {
    content = <PlayerQuizController state={state} playerId={playerId} send={room.send} />;
  } else if (state.phase === "freestyle_submitting") {
    content = (
      <PlayerFreestyleSubmit
        state={state}
        playerId={playerId}
        send={room.send}
        acceptedText={acceptedSubmissions[submissionKey] ?? null}
        onAcceptedText={(text) => setAcceptedSubmissions((prev) => ({ ...prev, [submissionKey]: text }))}
      />
    );
  } else if (state.phase === "freestyle_voting") {
    content = <PlayerVote state={state} playerId={playerId} send={room.send} />;
  } else if (state.phase === "round_results") {
    content = <PlayerWaiting state={state} playerId={playerId} title="Результаты на экране" />;
  } else if (state.phase === "finished") {
    content = <PlayerWaiting state={state} playerId={playerId} title="Финал" />;
  } else {
    content = <PlayerWaiting state={state} playerId={playerId} title="Ждём ведущий экран" />;
  }
  return (
    <>
      <RestoredToast visible={!!room.you?.reconnected} />
      {content}
    </>
  );
}

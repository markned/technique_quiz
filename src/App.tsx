import { useEffect, useMemo, useRef, useState } from "react";
import { rounds } from "../rounds";
import { LocalMediaPlayer } from "./adapters/localMediaPlayer";
import type { PlayerAdapter } from "./adapters/player";
import { IntroScreen } from "./components/IntroScreen";
import { OutroScreen } from "./components/OutroScreen";
import { RulesScreen } from "./components/RulesScreen";
import { QuizScreen } from "./components/QuizScreen";
import { StartScreen } from "./components/StartScreen";
import { TransitionOverlay } from "./components/TransitionOverlay";
import { pickLyricLines } from "./helpers/lyrics";
import { getYouTubeEmbedUrl, reorderNoConsecutiveSameTitle, shuffle, toLocalMediaUrl } from "./helpers/media";
import {
  assetUrl,
  getGuessSeconds,
  ROUND_DELAY_MS,
  SPECIAL_BG_BY_TITLE,
  STOP_SAFETY_MARGIN_SEC,
  TRANSITION_FADE_MS,
} from "./helpers/quizConfig";
import { playTimerEndSound, playTimerTickSound } from "./lib/timerSounds";
import { createAccurateCountdown, fadeOutVolume } from "./helpers/timing";
import type { RoundState } from "./types";

const createPlayer = (): PlayerAdapter => new LocalMediaPlayer();

export default function App() {
  const [roundState, setRoundState] = useState<RoundState>("intro");
  const [roundIndex, setRoundIndex] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState(60);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [isStartCinematic, setIsStartCinematic] = useState(false);
  const [upcomingRoundTitle, setUpcomingRoundTitle] = useState<string>("");
  const [visibleHintLineCount, setVisibleHintLineCount] = useState(0);

  const playerRef = useRef<PlayerAdapter | null>(null);
  const rafRef = useRef<number | null>(null);
  const countdownCancelRef = useRef<(() => void) | null>(null);
  const fadeCancelRef = useRef<(() => void) | null>(null);
  const pausedAtRef = useRef<number>(0);
  const hiddenRevealTapRef = useRef<{ count: number; lastTapMs: number }>({ count: 0, lastTapMs: 0 });

  const orderedRounds = useMemo(
    () =>
      reorderNoConsecutiveSameTitle(
        [...rounds].sort((a, b) => {
          const byRevealLength = a.revealLineIds.length - b.revealLineIds.length;
          if (byRevealLength !== 0) {
            return byRevealLength;
          }
          return a.id - b.id;
        }),
      ),
    [],
  );
  const orderedRoundsRef = useRef(orderedRounds);
  orderedRoundsRef.current = orderedRounds;
  const roundIndexRef = useRef(0);
  roundIndexRef.current = roundIndex;

  const randomPhotoSequence = useMemo(() => shuffle(orderedRounds.map((item) => item.id)), [orderedRounds]);

  const round = orderedRounds[roundIndex];
  const specialRoundBg = round ? SPECIAL_BG_BY_TITLE[round.title] : undefined;
  const roundYoutubeBackgroundEmbed = specialRoundBg
    ? getYouTubeEmbedUrl(specialRoundBg.url, specialRoundBg.start, { muted: true, controls: false, loop: true })
    : null;
  const roundPhotoBackground = round ? assetUrl(`/content/photos/${randomPhotoSequence[roundIndex]}.jpg`) : null;

  const hintLines = useMemo(
    () => (round ? pickLyricLines(round.lyrics, round.hintLineIds) : []),
    [round],
  );
  const revealLines = useMemo(
    () => (round ? pickLyricLines(round.lyrics, round.revealLineIds) : []),
    [round],
  );

  const stopPlaybackMonitor = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const stopCountdown = () => {
    countdownCancelRef.current?.();
    countdownCancelRef.current = null;
  };

  const stopFade = () => {
    fadeCancelRef.current?.();
    fadeCancelRef.current = null;
  };

  const ensurePlayer = () => {
    if (!playerRef.current) {
      playerRef.current = createPlayer();
    }
    return playerRef.current;
  };

  const startPlaybackMonitorForRound = (
    activeRound: (typeof orderedRounds)[number],
    hintLineCount: number,
    preserveGuessTimer: boolean,
  ) => {
    stopPlaybackMonitor();
    const player = ensurePlayer();
    const fragmentDuration = activeRound.end - activeRound.start;
    const lineInterval = hintLineCount > 0 ? fragmentDuration / hintLineCount : fragmentDuration;

    const monitor = () => {
      const time = player.getCurrentTime();
      const elapsed = time - activeRound.start;

      const targetLines = lineInterval > 0 ? Math.min(hintLineCount, Math.floor(elapsed / lineInterval) + 1) : hintLineCount;
      setVisibleHintLineCount((prev) => Math.max(prev, Math.min(targetLines, hintLineCount)));

      if (time >= activeRound.end - STOP_SAFETY_MARGIN_SEC) {
        setVisibleHintLineCount(hintLineCount);
        player.pause();
        pausedAtRef.current = time;
        setIsPlaying(false);
        const guessSec = getGuessSeconds(activeRound.revealLineIds.length);
        if (preserveGuessTimer) {
          setRoundState((prev) => (prev === "timer_finished" ? "timer_finished" : "paused_for_guess"));
          return;
        }
        setRoundState("paused_for_guess");
        setTimerSeconds(guessSec);

        let lastTickQuarter = Math.floor(guessSec / 4);
        countdownCancelRef.current = createAccurateCountdown(
          guessSec,
          (remaining) => {
            const q = Math.floor(remaining / 4);
            if (q !== lastTickQuarter && q > 0) {
              lastTickQuarter = q;
              playTimerTickSound();
            }
            setTimerSeconds(remaining);
          },
          () => {
            playTimerEndSound();
            setRoundState("timer_finished");
          },
        );
        return;
      }

      rafRef.current = requestAnimationFrame(monitor);
    };

    rafRef.current = requestAnimationFrame(monitor);
  };

  const startPlaybackMonitor = (preserveGuessTimer = false) => {
    if (!round) {
      return;
    }
    startPlaybackMonitorForRound(round, hintLines.length, preserveGuessTimer);
  };

  /** Загрузка раунда по индексу — без устаревших замыканий. */
  const loadRoundAtIndex = async (index: number) => {
    const r = orderedRoundsRef.current[index];
    if (!r) {
      setRoundState("finished");
      return;
    }
    const hints = pickLyricLines(r.lyrics, r.hintLineIds);
    stopPlaybackMonitor();
    stopCountdown();
    stopFade();
    setTimerSeconds(getGuessSeconds(r.revealLineIds.length));
    setVisibleHintLineCount(0);
    setRoundState("playing");

    const player = ensurePlayer();
    player.setVolume(1);
    await player.load(toLocalMediaUrl(r));
    player.seekTo(r.start);
    player.play();
    setIsPlaying(true);
    startPlaybackMonitorForRound(r, hints.length, false);
  };

  useEffect(() => {
    return () => {
      stopPlaybackMonitor();
      stopCountdown();
      stopFade();
      playerRef.current?.destroy?.();
    };
  }, []);

  const startQuiz = () => {
    if (isStartCinematic) {
      return;
    }
    setIsStartCinematic(true);
    setRoundIndex(0);
  };

  const playPause = () => {
    if (roundState !== "playing" && roundState !== "reveal") {
      return;
    }
    const player = ensurePlayer();
    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
      stopPlaybackMonitor();
      return;
    }
    player.play();
    setIsPlaying(true);
    if (roundState === "playing") {
      startPlaybackMonitor();
    }
  };

  const replaySnippet = () => {
    if (!round) {
      return;
    }
    const player = ensurePlayer();
    player.seekTo(round.start);
    player.play();
    setIsPlaying(true);
    if (roundState === "reveal") {
      return;
    }
    if (roundState === "paused_for_guess" || roundState === "timer_finished") {
      startPlaybackMonitor(true);
      return;
    }
    setVisibleHintLineCount(0);
    stopCountdown();
    setRoundState("playing");
    startPlaybackMonitor();
  };

  const revealAnswer = () => {
    if (roundState !== "timer_finished") {
      return;
    }
    const player = ensurePlayer();
    player.seekTo(pausedAtRef.current);
    player.play();
    setRoundState("reveal");
    setIsPlaying(true);
  };

  const forceReveal = () => {
    if (roundState === "reveal" || roundState === "transition" || roundState === "finished") {
      return;
    }
    stopPlaybackMonitor();
    stopCountdown();
    stopFade();
    const player = ensurePlayer();
    if (!round) return;
    const answerStart = round.end - STOP_SAFETY_MARGIN_SEC;
    pausedAtRef.current = answerStart;
    player.seekTo(answerStart);
    player.play();
    setRoundState("reveal");
    setIsPlaying(true);
    setVisibleHintLineCount(hintLines.length);
  };

  const handleRevealClick = () => {
    const now = performance.now();
    const isFastTap = now - hiddenRevealTapRef.current.lastTapMs < 1200;
    const nextCount = isFastTap ? hiddenRevealTapRef.current.count + 1 : 1;
    hiddenRevealTapRef.current = { count: nextCount, lastTapMs: now };
    if (nextCount >= 3) {
      hiddenRevealTapRef.current = { count: 0, lastTapMs: 0 };
      forceReveal();
      return;
    }
    if (roundState === "timer_finished") {
      revealAnswer();
    }
  };

  const beginRoundTransition = () => {
    const next = roundIndexRef.current + 1;
    const list = orderedRoundsRef.current;
    if (next < list.length) {
      setUpcomingRoundTitle(list[next].title);
    }
    const player = ensurePlayer();
    setRoundState("transition");
    stopPlaybackMonitor();
    stopCountdown();
    stopFade();

    fadeCancelRef.current = fadeOutVolume(player.setVolume.bind(player), TRANSITION_FADE_MS, () => {
      player.pause();
      player.setVolume(1);
      setIsPlaying(false);
      const current = roundIndexRef.current;
      const next = current + 1;
      const list = orderedRoundsRef.current;
      if (next >= list.length) {
        setRoundState("finished");
        return;
      }
      setRoundIndex(next);
      setTimeout(() => void loadRoundAtIndex(next), ROUND_DELAY_MS);
    });
  };

  const skipIntroAndGoToRules = () => {
    setIsStartCinematic(false);
    setRoundState("rules");
  };

  const onIntroVideoEnded = () => {
    setRoundState("rules");
  };

  const skipRulesAndStart = () => {
    setUpcomingRoundTitle(orderedRoundsRef.current[0]?.title ?? "");
    setRoundState("transition");
    setTimeout(() => void loadRoundAtIndex(0), ROUND_DELAY_MS);
  };

  const nextRound = () => {
    if (roundState === "reveal") {
      beginRoundTransition();
      return;
    }
  };

  const restartQuiz = () => {
    stopPlaybackMonitor();
    stopCountdown();
    stopFade();
    playerRef.current?.pause();
    playerRef.current?.setVolume(1);
    setRoundIndex(0);
    setTimerSeconds(60);
    setIsPlaying(false);
    setIsStartCinematic(false);
    setRoundState("intro");
  };

  if (roundState === "intro") {
    if (isStartCinematic) {
      return (
        <IntroScreen onVideoEnded={onIntroVideoEnded} onSkip={skipIntroAndGoToRules} />
      );
    }
    return (
      <main className="app-shell">
        <StartScreen onStart={startQuiz} />
      </main>
    );
  }

  if (roundState === "rules") {
    return <RulesScreen onComplete={skipRulesAndStart} />;
  }

  if (roundState === "finished") {
    return <OutroScreen onRestart={restartQuiz} />;
  }

  if (!round) {
    return null;
  }

  return (
    <main className="app-shell">
      {roundYoutubeBackgroundEmbed ? (
        <iframe
          key={`${round.id}-youtube-bg`}
          className="youtube-bg"
          src={roundYoutubeBackgroundEmbed}
          title="Фоновое видео YouTube"
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : null}
      {!roundYoutubeBackgroundEmbed && roundPhotoBackground ? (
        <div className="photo-bg" style={{ backgroundImage: `url("${roundPhotoBackground}")` }} />
      ) : null}
      <div className="app-overlay" key={roundIndex}>
        <QuizScreen
          round={round}
          roundIndex={roundIndex}
          totalRounds={orderedRounds.length}
          roundState={roundState}
          hintLines={hintLines}
          revealLines={revealLines}
          visibleHintLineCount={visibleHintLineCount}
          timerSeconds={timerSeconds}
          totalSeconds={getGuessSeconds(revealLines.length)}
          isPlaying={isPlaying}
          onPlayPause={playPause}
          onReplaySnippet={replaySnippet}
          onReveal={handleRevealClick}
          onNextRound={nextRound}
          onRestartRequest={() => setShowRestartConfirm(true)}
        />
      </div>
      {showRestartConfirm ? (
        <div className="confirm-backdrop" role="dialog" aria-modal="true">
          <div className="confirm-dialog">
            <h4>Перезапустить викторину?</h4>
            <p>Текущий прогресс по раундам будет сброшен.</p>
            <div className="confirm-actions">
              <button className="btn" onClick={() => setShowRestartConfirm(false)}>
                Отмена
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  setShowRestartConfirm(false);
                  restartQuiz();
                }}
              >
                Перезапустить
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <TransitionOverlay visible={roundState === "transition"} nextRoundTitle={upcomingRoundTitle} />
    </main>
  );
}

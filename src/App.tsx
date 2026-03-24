import { useEffect, useMemo, useRef, useState } from "react";
import { rounds } from "../rounds";
import { LocalMediaPlayer } from "./adapters/localMediaPlayer";
import type { PlayerAdapter } from "./adapters/player";
import { IntroScreen } from "./components/IntroScreen";
import { OutroScreen } from "./components/OutroScreen";
import { GamePauseToggle } from "./components/GamePauseToggle";
import { QuizBackground } from "./components/QuizBackground";
import { QuizScreen } from "./components/QuizScreen";
import { RestartConfirmDialog } from "./components/RestartConfirmDialog";
import { RulesScreen } from "./components/RulesScreen";
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
import {
  preRollSeekAndFadeInMs,
  transitionOverlayTitle,
  visibleHintCountAtTime,
} from "./helpers/quizPlayback";
import { createAccurateCountdown, fadeInVolume, fadeOutVolume } from "./helpers/timing";
import {
  playTimerEndSound,
  playTimerTickSound,
  setTimerSoundsDucked,
  stopAllTimerCountSounds,
} from "./lib/timerSounds";
import type { RoundState } from "./types";

const createPlayer = (): PlayerAdapter => new LocalMediaPlayer();

export default function App() {
  const [roundState, setRoundState] = useState<RoundState>("intro");
  const [roundIndex, setRoundIndex] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState(60);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [isStartCinematic, setIsStartCinematic] = useState(false);
  const [upcomingRoundTitle, setUpcomingRoundTitle] = useState<string>("");
  const [visibleHintLineCount, setVisibleHintLineCount] = useState(0);
  const [gamePaused, setGamePaused] = useState(false);

  const playerRef = useRef<PlayerAdapter | null>(null);
  const rafRef = useRef<number | null>(null);
  const countdownCancelRef = useRef<(() => void) | null>(null);
  const fadeCancelRef = useRef<(() => void) | null>(null);
  const pausedAtRef = useRef<number>(0);
  const hiddenRevealTapRef = useRef<{ count: number; lastTapMs: number }>({ count: 0, lastTapMs: 0 });
  const roundStateRef = useRef<RoundState>(roundState);
  const timerSecondsRef = useRef(timerSeconds);
  roundStateRef.current = roundState;
  timerSecondsRef.current = timerSeconds;

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
    setTimerSoundsDucked(false);
    stopAllTimerCountSounds();
  };

  const stopFade = () => {
    fadeCancelRef.current?.();
    fadeCancelRef.current = null;
  };

  const stopPlaybackTimersAndFade = () => {
    stopPlaybackMonitor();
    stopCountdown();
    stopFade();
  };

  const unmutePlayer = (player: PlayerAdapter) => {
    stopFade();
    player.setVolume(1);
  };

  const ensurePlayer = () => {
    if (!playerRef.current) {
      playerRef.current = createPlayer();
    }
    return playerRef.current;
  };

  const startGuessCountdown = (guessSec: number) => {
    let lastTickSegment = -1;
    countdownCancelRef.current = createAccurateCountdown(
      guessSec,
      (remaining) => {
        const elapsed = guessSec - remaining;
        const segment = Math.floor(elapsed / 4);
        if (segment !== lastTickSegment && segment >= 0) {
          lastTickSegment = segment;
          playTimerTickSound();
        }
        setTimerSeconds(remaining);
      },
      () => {
        playTimerEndSound();
        setRoundState("timer_finished");
      },
    );
  };

  const startPlaybackMonitorForRound = (
    activeRound: (typeof orderedRounds)[number],
    hintLineCount: number,
    preserveGuessTimer: boolean,
  ) => {
    stopPlaybackMonitor();
    const player = ensurePlayer();

    const monitor = () => {
      const time = player.getCurrentTime();
      const targetLines = visibleHintCountAtTime(time, activeRound, hintLineCount);
      setVisibleHintLineCount((prev) => Math.max(prev, targetLines));

      if (time >= activeRound.end - STOP_SAFETY_MARGIN_SEC) {
        setVisibleHintLineCount(hintLineCount);
        player.pause();
        pausedAtRef.current = time;
        const guessSec = getGuessSeconds(activeRound.revealLineIds.length);
        if (preserveGuessTimer) {
          setTimerSoundsDucked(false);
          setRoundState((prev) => (prev === "timer_finished" ? "timer_finished" : "paused_for_guess"));
          return;
        }
        setRoundState("paused_for_guess");
        setTimerSeconds(guessSec);
        startGuessCountdown(guessSec);
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

  const loadRoundAtIndex = async (index: number) => {
    const r = orderedRoundsRef.current[index];
    if (!r) {
      setRoundState("finished");
      return;
    }
    const hints = pickLyricLines(r.lyrics, r.hintLineIds);
    stopPlaybackTimersAndFade();
    setGamePaused(false);
    setTimerSeconds(getGuessSeconds(r.revealLineIds.length));
    setVisibleHintLineCount(0);
    setRoundState("playing");

    const player = ensurePlayer();
    await player.load(toLocalMediaUrl(r));
    const { preRollStartSec, fadeInMs } = preRollSeekAndFadeInMs(r.start, TRANSITION_FADE_MS);

    player.seekTo(preRollStartSec);
    player.setVolume(0);
    player.play();
    if (fadeInMs <= 0) {
      player.setVolume(1);
    } else {
      fadeCancelRef.current = fadeInVolume(player.setVolume.bind(player), fadeInMs, () => {
        fadeCancelRef.current = null;
      });
    }
    startPlaybackMonitorForRound(r, hints.length, false);
  };

  useEffect(() => {
    return () => {
      stopPlaybackTimersAndFade();
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

  const toggleGamePause = () => {
    if (roundStateRef.current === "transition") {
      return;
    }

    if (!gamePaused) {
      stopFade();
      ensurePlayer().pause();
      stopPlaybackMonitor();
      countdownCancelRef.current?.();
      countdownCancelRef.current = null;
      setTimerSoundsDucked(false);
      stopAllTimerCountSounds();
      setGamePaused(true);
      return;
    }

    setGamePaused(false);
    const r = orderedRoundsRef.current[roundIndexRef.current];
    if (!r) {
      return;
    }
    const hints = pickLyricLines(r.lyrics, r.hintLineIds);
    const rs = roundStateRef.current;
    const player = ensurePlayer();

    if (rs === "playing") {
      unmutePlayer(player);
      player.play();
      startPlaybackMonitorForRound(r, hints.length, false);
    } else if (rs === "reveal") {
      unmutePlayer(player);
      player.play();
    } else if (rs === "paused_for_guess") {
      startGuessCountdown(timerSecondsRef.current);
    }
  };

  const replaySnippet = () => {
    if (gamePaused || !round) {
      return;
    }
    const player = ensurePlayer();
    unmutePlayer(player);
    player.seekTo(round.start);
    player.play();
    if (roundState === "reveal") {
      return;
    }
    if (roundState === "paused_for_guess" || roundState === "timer_finished") {
      if (roundState === "paused_for_guess" && countdownCancelRef.current) {
        setTimerSoundsDucked(true);
      }
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
    unmutePlayer(player);
    player.seekTo(pausedAtRef.current);
    player.play();
    setRoundState("reveal");
  };

  const forceReveal = () => {
    if (gamePaused) {
      return;
    }
    if (roundState === "reveal" || roundState === "transition" || roundState === "finished") {
      return;
    }
    stopPlaybackTimersAndFade();
    const player = ensurePlayer();
    if (!round) return;
    const answerStart = round.end - STOP_SAFETY_MARGIN_SEC;
    pausedAtRef.current = answerStart;
    unmutePlayer(player);
    player.seekTo(answerStart);
    player.play();
    setRoundState("reveal");
    setVisibleHintLineCount(hintLines.length);
  };

  const handleRevealClick = () => {
    if (gamePaused) {
      return;
    }
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
    setGamePaused(false);
    const list = orderedRoundsRef.current;
    const nextIdx = roundIndexRef.current + 1;
    setUpcomingRoundTitle(transitionOverlayTitle(nextIdx, list));

    const player = ensurePlayer();
    setRoundState("transition");
    stopPlaybackTimersAndFade();

    fadeCancelRef.current = fadeOutVolume(player.setVolume.bind(player), TRANSITION_FADE_MS, () => {
      player.pause();
      player.setVolume(1);
      const current = roundIndexRef.current;
      const next = current + 1;
      const roundsList = orderedRoundsRef.current;
      if (next >= roundsList.length) {
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
    const list = orderedRoundsRef.current;
    setUpcomingRoundTitle(list[0]?.title ?? "");
    setRoundState("transition");
    setTimeout(() => void loadRoundAtIndex(0), ROUND_DELAY_MS);
  };

  const nextRound = () => {
    if (gamePaused || roundState !== "reveal") {
      return;
    }
    beginRoundTransition();
  };

  const restartQuiz = () => {
    stopPlaybackTimersAndFade();
    setGamePaused(false);
    playerRef.current?.pause();
    playerRef.current?.setVolume(1);
    setRoundIndex(0);
    setTimerSeconds(60);
    setIsStartCinematic(false);
    setRoundState("intro");
  };

  if (roundState === "intro") {
    if (isStartCinematic) {
      return <IntroScreen onVideoEnded={onIntroVideoEnded} onSkip={skipIntroAndGoToRules} />;
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
    <main className="app-shell app-shell-quiz">
      <QuizBackground photoUrl={roundPhotoBackground} youtubeSrc={roundYoutubeBackgroundEmbed} />
      <GamePauseToggle
        paused={gamePaused}
        disabled={roundState === "transition"}
        onToggle={toggleGamePause}
      />
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
          onReplaySnippet={replaySnippet}
          onReveal={handleRevealClick}
          onNextRound={nextRound}
          onRestartRequest={() => setShowRestartConfirm(true)}
        />
      </div>
      <RestartConfirmDialog
        open={showRestartConfirm}
        onCancel={() => setShowRestartConfirm(false)}
        onConfirm={() => {
          setShowRestartConfirm(false);
          restartQuiz();
        }}
      />
      <TransitionOverlay visible={roundState === "transition"} nextRoundTitle={upcomingRoundTitle} />
    </main>
  );
}

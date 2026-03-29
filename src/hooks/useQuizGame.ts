import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rounds as allRounds } from "../content/rounds";
import { LocalMediaPlayer } from "../adapters/localMediaPlayer";
import type { PlayerAdapter } from "../adapters/player";
import { useCoarsePointer } from "./useCoarsePointer";
import { useGesturePauseLayout } from "./useGesturePauseLayout";
import { pickLyricLines } from "../helpers/lyrics";
import { getYouTubeEmbedUrl, toLocalMediaUrl } from "../helpers/media";
import { buildQuizEligiblePool, buildQuizSessionPlayOrder } from "../helpers/quizMode";
import { buildQuizMcOptions, getQuizUiVariant, type QuizUiVariant } from "../helpers/quizOptions";
import { shuffle } from "../helpers/shuffle";
import { buildSessionPlayOrder } from "../helpers/quizOrder";
import { buildBackgroundPhotoSequence } from "../helpers/backgroundPhotos";
import {
  assetUrl,
  assetUrlVideoRelative,
  getGuessSeconds,
  OUTRO_QUIZ_VIDEOS,
  OUTRO_VIDEO_PATH,
  outroQuizVideoIndexForScore,
  QUIZ_FEEDBACK_DELAY_MS,
  QUIZ_FEEDBACK_DELAY_WRONG_MS,
  ROUND_DELAY_MS,
  STOP_SAFETY_MARGIN_SEC,
  TRANSITION_FADE_MS,
} from "../helpers/quizConfig";
import { BACKGROUND_PHOTO_FILENAMES } from "virtual:background-photos";
import {
  preRollSeekAndFadeInMs,
  transitionOverlayTitle,
  visibleHintCountAtTime,
} from "../helpers/quizPlayback";
import { createAccurateCountdown, fadeInVolume, fadeOutVolume } from "../helpers/timing";
import {
  playQuizAnswerFeedbackSound,
  playTimerEndSound,
  playTimerTickSound,
  setTimerSoundsDucked,
  stopAllTimerCountSounds,
} from "../lib/timerSounds";
import type { GameMode, Round, RoundState } from "../types";
import {
  clearPreviewRoundStorage,
  editorHref,
  isPreviewQueryActive,
  loadPreviewRoundFromStorageAsync,
  parsePreviewRoundFromSession,
  stripPreviewQueryFromUrl,
} from "../editor/previewRoundStorage";

const createPlayer = (): PlayerAdapter => new LocalMediaPlayer();

function visibleRoundsForSession(): Round[] {
  return allRounds.filter((r) => !r.hidden);
}

function tryParseInlinePreviewRound(): Round | null {
  return parsePreviewRoundFromSession();
}

function useInitialPreviewRound(): { previewRound: Round | null; previewLoading: boolean } {
  const [previewRound, setPreviewRound] = useState<Round | null>(() => tryParseInlinePreviewRound());
  const [previewLoading, setPreviewLoading] = useState(
    () => isPreviewQueryActive() && tryParseInlinePreviewRound() === null,
  );

  useEffect(() => {
    if (!previewLoading) return;
    let cancelled = false;
    void loadPreviewRoundFromStorageAsync().then((r) => {
      if (cancelled) return;
      clearPreviewRoundStorage();
      stripPreviewQueryFromUrl();
      setPreviewRound(r);
      setPreviewLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [previewLoading]);

  useEffect(() => {
    if (previewLoading) return;
    if (!previewRound) return;
    if (!isPreviewQueryActive()) return;
    clearPreviewRoundStorage();
    stripPreviewQueryFromUrl();
  }, [previewLoading, previewRound]);

  return { previewRound, previewLoading };
}

export function useQuizGame() {
  const { previewRound, previewLoading } = useInitialPreviewRound();
  const isPreviewModeRef = useRef(!!previewRound);
  isPreviewModeRef.current = !!previewRound;

  const [roundState, setRoundState] = useState<RoundState>(() =>
    tryParseInlinePreviewRound() ? "transition" : "intro",
  );
  const [roundIndex, setRoundIndex] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState(() =>
    previewRound ? getGuessSeconds(previewRound.revealLineIds.length) : 60,
  );
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showRulesOverlay, setShowRulesOverlay] = useState(false);
  const [isStartCinematic, setIsStartCinematic] = useState(false);
  /** Режим предпросмотра из редактора: `?preview=1&previewMode=…` (читается один раз до сброса URL). */
  const [previewEditorGameMode] = useState<GameMode>(() => {
    if (typeof window === "undefined") return "freestyle";
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("preview") !== "1") return "freestyle";
    return sp.get("previewMode") === "quiz" ? "quiz" : "freestyle";
  });

  const [gameMode, setGameMode] = useState<GameMode | null>(null);
  const [quizScore, setQuizScore] = useState(0);
  const [quizOptions, setQuizOptions] = useState<string[]>([]);
  const [quizUiVariant, setQuizUiVariant] = useState<QuizUiVariant | null>(null);
  const [quizOrderUserIds, setQuizOrderUserIds] = useState<number[]>([]);
  const [selectedQuizIndex, setSelectedQuizIndex] = useState<number | null>(null);
  const [upcomingRoundTitle, setUpcomingRoundTitle] = useState<string>(() => previewRound?.title ?? "");
  const [visibleHintLineCount, setVisibleHintLineCount] = useState(0);
  const [gamePaused, setGamePaused] = useState(false);
  const isCoarsePointer = useCoarsePointer();
  const gesturePauseLayout = useGesturePauseLayout();

  const playerRef = useRef<PlayerAdapter | null>(null);
  const rafRef = useRef<number | null>(null);
  const countdownCancelRef = useRef<(() => void) | null>(null);
  const fadeCancelRef = useRef<(() => void) | null>(null);
  const pausedAtRef = useRef<number>(0);
  const hiddenRevealTapRef = useRef<{ count: number; lastTapMs: number }>({ count: 0, lastTapMs: 0 });
  const resetHiddenRevealTap = () => {
    hiddenRevealTapRef.current = { count: 0, lastTapMs: 0 };
  };
  const roundStateRef = useRef<RoundState>(roundState);
  const gameModeRef = useRef<GameMode | null>(null);
  const timerSecondsRef = useRef(timerSeconds);
  const gamePausedRef = useRef(false);
  const quizCorrectIndexRef = useRef(0);
  const selectedQuizIndexRef = useRef<number | null>(null);
  const quizUiVariantRef = useRef<QuizUiVariant | null>(null);
  const quizOrderUserIdsRef = useRef<number[]>([]);
  const quizDistractorPoolRef = useRef<Round[]>([]);
  const quizFeedbackTimeoutRef = useRef<number | null>(null);
  const [quizCorrectIndex, setQuizCorrectIndex] = useState(0);
  const replaySnippetRef = useRef<() => void>(() => {});
  const nextRoundRef = useRef<() => void>(() => {});
  const handleRevealClickRef = useRef<() => void>(() => {});
  const confirmQuizRoundRef = useRef<() => void>(() => {});
  /** После перехода из редактора `?preview=1` — новая страница без жеста; Safari блокирует звук до первого касания. */
  const previewInitialGestureDoneRef = useRef(false);
  roundStateRef.current = roundState;
  gameModeRef.current = gameMode;
  timerSecondsRef.current = timerSeconds;
  gamePausedRef.current = gamePaused;
  selectedQuizIndexRef.current = selectedQuizIndex;
  quizUiVariantRef.current = quizUiVariant;
  quizOrderUserIdsRef.current = quizOrderUserIds;

  const [playOrder, setPlayOrder] = useState<Round[]>(() => {
    const inline = tryParseInlinePreviewRound();
    if (inline) return [inline];
    if (isPreviewQueryActive()) return [];
    return buildSessionPlayOrder(visibleRoundsForSession());
  });

  useEffect(() => {
    if (previewLoading) return;
    if (previewRound) {
      setPlayOrder([previewRound]);
      return;
    }
    setPlayOrder((prev) =>
      prev.length === 0 ? buildSessionPlayOrder(visibleRoundsForSession()) : prev,
    );
  }, [previewLoading, previewRound]);

  useEffect(() => {
    if (previewLoading) return;
    if (!previewRound) return;
    setRoundState("transition");
    setTimerSeconds(getGuessSeconds(previewRound.revealLineIds.length));
    setUpcomingRoundTitle(transitionOverlayTitle(0, [previewRound]));
  }, [previewLoading, previewRound]);
  const orderedRounds = playOrder;
  const orderedRoundsRef = useRef(orderedRounds);
  orderedRoundsRef.current = orderedRounds;
  const roundIndexRef = useRef(0);
  roundIndexRef.current = roundIndex;

  const randomPhotoSequence = useMemo(
    () => buildBackgroundPhotoSequence(orderedRounds.length, BACKGROUND_PHOTO_FILENAMES),
    [orderedRounds],
  );

  const round = orderedRounds[roundIndex];
  const roundVideoBackgroundUrl = round?.backgroundVideo
    ? assetUrlVideoRelative(round.backgroundVideo.file)
    : null;
  const roundVideoBackgroundStart = round?.backgroundVideo?.start ?? 0;
  const roundYoutubeBackgroundEmbed =
    round?.backgroundVideo || !round?.backgroundYoutube
      ? null
      : getYouTubeEmbedUrl(round.backgroundYoutube.url, round.backgroundYoutube.start, {
          muted: true,
          controls: false,
          loop: true,
        });
  const roundPhotoBackground =
    round && randomPhotoSequence[roundIndex]
      ? assetUrl(`/content/photos/${randomPhotoSequence[roundIndex]}`)
      : null;

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

  const clearQuizFeedbackTimeout = () => {
    if (quizFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(quizFeedbackTimeoutRef.current);
      quizFeedbackTimeoutRef.current = null;
    }
  };

  const stopPlaybackTimersAndFade = () => {
    stopPlaybackMonitor();
    stopCountdown();
    stopFade();
    clearQuizFeedbackTimeout();
  };

  const unmutePlayer = (player: PlayerAdapter) => {
    stopFade();
    player.setMuted(false);
    player.setVolume(1);
  };

  const ensurePlayer = () => {
    if (!playerRef.current) {
      playerRef.current = createPlayer();
    }
    return playerRef.current;
  };

  const enterRevealState = () => {
    const player = ensurePlayer();
    unmutePlayer(player);
    player.seekTo(pausedAtRef.current);
    player.play();
    setRoundState("reveal");
  };

  const finalizeQuizRound = () => {
    const r = orderedRoundsRef.current[roundIndexRef.current];
    const variant = quizUiVariantRef.current;
    let isCorrect = false;
    if (variant === "order" && r) {
      const order = quizOrderUserIdsRef.current;
      const reveal = r.revealLineIds;
      isCorrect = order.length === reveal.length && order.every((id, i) => id === reveal[i]);
    } else if (variant === "mc4") {
      const selected = selectedQuizIndexRef.current;
      const correctIdx = quizCorrectIndexRef.current;
      isCorrect = selected !== null && selected === correctIdx;
    } else {
      isCorrect = false;
    }
    if (isCorrect) {
      setQuizScore((s) => s + 1);
    }
    playQuizAnswerFeedbackSound(isCorrect);
    clearQuizFeedbackTimeout();
    setRoundState("quiz_feedback");
    const feedbackMs = isCorrect ? QUIZ_FEEDBACK_DELAY_MS : QUIZ_FEEDBACK_DELAY_WRONG_MS;
    quizFeedbackTimeoutRef.current = window.setTimeout(() => {
      quizFeedbackTimeoutRef.current = null;
      enterRevealState();
    }, feedbackMs);
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
        if (gameModeRef.current === "quiz") {
          finalizeQuizRound();
        } else {
          playTimerEndSound();
          setRoundState("timer_finished");
        }
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
    if (gameModeRef.current === "quiz") {
      const v = getQuizUiVariant(r);
      setQuizUiVariant(v);
      if (v === "mc4") {
        const built = buildQuizMcOptions(r, quizDistractorPoolRef.current);
        quizCorrectIndexRef.current = built.correctIndex;
        setQuizCorrectIndex(built.correctIndex);
        setQuizOptions(built.options);
        setSelectedQuizIndex(null);
        setQuizOrderUserIds([]);
      } else if (v === "order") {
        quizCorrectIndexRef.current = 0;
        setQuizCorrectIndex(0);
        setQuizOptions([]);
        setSelectedQuizIndex(null);
        const ids = r.revealLineIds;
        let shuffled = shuffle([...ids]);
        let tries = 0;
        while (tries < 40 && ids.length === shuffled.length && ids.every((id, i) => id === shuffled[i])) {
          shuffled = shuffle([...ids]);
          tries += 1;
        }
        setQuizOrderUserIds(shuffled);
      } else {
        setQuizOptions([]);
        setSelectedQuizIndex(null);
        setQuizOrderUserIds([]);
        setQuizCorrectIndex(0);
      }
    } else {
      setQuizUiVariant(null);
      setQuizOptions([]);
      setSelectedQuizIndex(null);
      setQuizOrderUserIds([]);
      setQuizCorrectIndex(0);
    }

    const player = ensurePlayer();
    await player.load(toLocalMediaUrl(r));
    const { preRollStartSec, fadeInMs } = preRollSeekAndFadeInMs(r.start, TRANSITION_FADE_MS);

    await player.seekToAsync(preRollStartSec);
    player.setVolume(0);
    // Safari: первый play с muted=true иногда не крутит таймлайн до пользовательского жеста; «Повтор» уже идёт
    // с unmutePlayer + play(). Сначала пробуем «тихий» неслышимый вывод (volume 0, без muted), иначе — классический muted.
    player.setMuted(false);
    try {
      await player.playAsync();
    } catch {
      try {
        player.setMuted(true);
        await player.playAsync();
      } catch {
        void player.play();
      }
    }
    if (fadeInMs <= 0) {
      player.setMuted(false);
      player.setVolume(1);
    } else {
      fadeCancelRef.current = fadeInVolume(player.setVolume.bind(player), fadeInMs, () => {
        fadeCancelRef.current = null;
      });
    }
    startPlaybackMonitorForRound(r, hints.length, false);
  };

  useEffect(() => {
    if (!previewRound) return;
    setGameMode(previewEditorGameMode);
    if (previewEditorGameMode === "quiz") {
      quizDistractorPoolRef.current = buildQuizEligiblePool(visibleRoundsForSession());
    } else {
      quizDistractorPoolRef.current = [];
    }
  }, [previewRound, previewEditorGameMode]);

  useEffect(() => {
    if (!previewRound) {
      previewInitialGestureDoneRef.current = false;
      return;
    }
    if (orderedRounds.length === 0) return;
    if (previewInitialGestureDoneRef.current) return;

    let timeoutId: number | null = null;

    const detach = () => {
      window.removeEventListener("pointerdown", onFirstGesture, { capture: true });
      window.removeEventListener("keydown", onFirstKey, { capture: true });
    };

    const startAfterDelay = () => {
      if (previewInitialGestureDoneRef.current) return;
      previewInitialGestureDoneRef.current = true;
      detach();
      timeoutId = window.setTimeout(() => void loadRoundAtIndex(0), ROUND_DELAY_MS);
    };

    const onFirstGesture = () => startAfterDelay();
    const onFirstKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.repeat) return;
      startAfterDelay();
    };

    window.addEventListener("pointerdown", onFirstGesture, { passive: true, capture: true });
    window.addEventListener("keydown", onFirstKey, { capture: true });
    return () => {
      detach();
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [previewRound, orderedRounds.length]);

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

  const toggleGamePauseRef = useRef<() => void>(() => {});

  const toggleGamePause = () => {
    if (roundStateRef.current === "transition" || roundStateRef.current === "quiz_feedback") {
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

  toggleGamePauseRef.current = toggleGamePause;

  const isQuizMainView =
    !!round &&
    (roundState === "playing" ||
      roundState === "paused_for_guess" ||
      roundState === "quiz_feedback" ||
      roundState === "timer_finished" ||
      roundState === "reveal" ||
      roundState === "transition");

  useEffect(() => {
    if (!isCoarsePointer || !isQuizMainView) {
      return;
    }
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) {
        return;
      }
      if (roundStateRef.current === "transition" || roundStateRef.current === "quiz_feedback") {
        return;
      }
      e.preventDefault();
      toggleGamePauseRef.current();
    };
    window.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
    return () => window.removeEventListener("touchstart", onTouchStart, true);
  }, [isCoarsePointer, isQuizMainView]);

  const replaySnippet = () => {
    if (gamePaused || !round) {
      return;
    }
    if (roundState === "quiz_feedback") {
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
    if (gameModeRef.current === "quiz" && quizUiVariantRef.current === "mc4") {
      setSelectedQuizIndex(null);
    }
    setRoundState("playing");
    startPlaybackMonitor();
  };

  const revealAnswer = () => {
    if (roundState !== "timer_finished") {
      return;
    }
    enterRevealState();
  };

  const confirmQuizRound = () => {
    if (gameModeRef.current !== "quiz") {
      return;
    }
    if (roundStateRef.current !== "paused_for_guess") {
      return;
    }
    if (quizUiVariantRef.current === "mc4" && selectedQuizIndexRef.current === null) {
      return;
    }
    stopCountdown();
    finalizeQuizRound();
  };

  const forceReveal = () => {
    if (gameModeRef.current === "quiz") {
      return;
    }
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
    if (gameModeRef.current === "quiz") {
      return;
    }
    if (gamePaused) {
      return;
    }
    const now = performance.now();
    const isFastTap = now - hiddenRevealTapRef.current.lastTapMs < 1200;
    const nextCount = isFastTap ? hiddenRevealTapRef.current.count + 1 : 1;
    hiddenRevealTapRef.current = { count: nextCount, lastTapMs: now };
    if (nextCount >= 3) {
      resetHiddenRevealTap();
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
        if (isPreviewModeRef.current) {
          window.location.href = editorHref();
          return;
        }
        setRoundState("finished");
        return;
      }
      setRoundIndex(next);
      setTimeout(() => void loadRoundAtIndex(next), ROUND_DELAY_MS);
    });
  };

  const skipIntroAndGoToRules = () => {
    setIsStartCinematic(false);
    setRoundState("game_rules");
  };

  const onIntroVideoEnded = () => {
    setIsStartCinematic(false);
    setRoundState("game_rules");
  };

  const skipGameRulesToModeSelect = () => {
    setRoundState("mode_select");
  };

  const beginGameFromRules = () => {
    const list = orderedRoundsRef.current;
    setUpcomingRoundTitle(list[0]?.title ?? "");
    setRoundState("transition");
    setTimeout(() => void loadRoundAtIndex(0), ROUND_DELAY_MS);
  };

  const skipRulesAndStart = () => {
    if (!gameModeRef.current) {
      return;
    }
    beginGameFromRules();
  };

  const selectGameMode = (mode: GameMode) => {
    setGameMode(mode);
    const visible = visibleRoundsForSession();
    if (mode === "quiz") {
      quizDistractorPoolRef.current = buildQuizEligiblePool(visible);
      setPlayOrder(buildQuizSessionPlayOrder(visible));
    } else {
      quizDistractorPoolRef.current = [];
      setPlayOrder(buildSessionPlayOrder(visible));
    }
    setRoundState("rules");
  };

  const nextRound = () => {
    if (gamePaused || roundState !== "reveal") {
      return;
    }
    beginRoundTransition();
  };

  replaySnippetRef.current = replaySnippet;
  nextRoundRef.current = nextRound;
  handleRevealClickRef.current = handleRevealClick;
  confirmQuizRoundRef.current = confirmQuizRound;

  useEffect(() => {
    if (!isQuizMainView) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (showRestartConfirm || showExitConfirm) {
        return;
      }
      if (showRulesOverlay) {
        if (e.code === "Escape") {
          e.preventDefault();
          setShowRulesOverlay(false);
        }
        return;
      }
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("input, textarea, select, [contenteditable]")) {
        return;
      }

      const rs = roundStateRef.current;
      if (rs === "transition") {
        if (e.code === "Space") {
          e.preventDefault();
        }
        return;
      }

      if (rs === "quiz_feedback") {
        e.preventDefault();
        return;
      }

      if (e.code === "Escape") {
        e.preventDefault();
        toggleGamePauseRef.current();
        return;
      }

      if (e.code === "KeyR" && !e.repeat) {
        e.preventDefault();
        replaySnippetRef.current();
        return;
      }

      if (e.code === "ArrowRight" && !e.repeat) {
        if (gamePausedRef.current) {
          return;
        }
        if (rs !== "reveal") {
          return;
        }
        e.preventDefault();
        nextRoundRef.current();
        return;
      }

      if (e.code === "Space" || e.key === " ") {
        if (gamePausedRef.current) {
          return;
        }
        if (rs === "reveal") {
          e.preventDefault();
          return;
        }
        if (gameModeRef.current === "quiz" && rs === "paused_for_guess") {
          e.preventDefault();
          confirmQuizRoundRef.current();
          return;
        }
        e.preventDefault();
        handleRevealClickRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isQuizMainView, showRestartConfirm, showExitConfirm, showRulesOverlay]);

  const exitToStartScreen = () => {
    stopPlaybackTimersAndFade();
    setGamePaused(false);
    setShowRestartConfirm(false);
    setShowExitConfirm(false);
    setShowRulesOverlay(false);
    playerRef.current?.pause();
    playerRef.current?.setVolume(1);
    if (previewRound) {
      window.location.href = editorHref();
      return;
    }
    setRoundIndex(0);
    setTimerSeconds(60);
    setVisibleHintLineCount(0);
    resetHiddenRevealTap();
    setIsStartCinematic(false);
    setGameMode(null);
    setQuizScore(0);
    setQuizOptions([]);
    setQuizUiVariant(null);
    setQuizOrderUserIds([]);
    setSelectedQuizIndex(null);
    setQuizCorrectIndex(0);
    setRoundState("intro");
  };

  /** Пауза / аутро: вернуться к выбору режима (не к стартовому экрану) */
  const returnToModeSelect = () => {
    if (previewRound) {
      window.location.href = editorHref();
      return;
    }
    stopPlaybackTimersAndFade();
    setGamePaused(false);
    setShowRestartConfirm(false);
    setShowExitConfirm(false);
    setShowRulesOverlay(false);
    playerRef.current?.pause();
    playerRef.current?.setVolume(1);
    setRoundIndex(0);
    setVisibleHintLineCount(0);
    resetHiddenRevealTap();
    setQuizScore(0);
    setQuizOptions([]);
    setQuizUiVariant(null);
    setQuizOrderUserIds([]);
    setSelectedQuizIndex(null);
    setQuizCorrectIndex(0);
    setTimerSeconds(60);
    setGameMode(null);
    quizDistractorPoolRef.current = [];
    setPlayOrder(buildSessionPlayOrder(visibleRoundsForSession()));
    setIsStartCinematic(false);
    setRoundState("mode_select");
  };

  const outroVideoSrc = useMemo(() => {
    if (gameMode === "quiz") {
      return OUTRO_QUIZ_VIDEOS[outroQuizVideoIndexForScore(quizScore)];
    }
    return OUTRO_VIDEO_PATH;
  }, [gameMode, quizScore]);

  const quizEligibleCount = useMemo(
    () => buildQuizEligiblePool(visibleRoundsForSession()).length,
    [],
  );

  const setQuizSelection = (index: number | null) => {
    if (gameModeRef.current !== "quiz") return;
    if (roundStateRef.current !== "paused_for_guess") return;
    setSelectedQuizIndex(index);
  };

  const reorderQuizOrderLines = useCallback((ids: number[]) => {
    if (gameModeRef.current !== "quiz") return;
    if (roundStateRef.current !== "paused_for_guess") return;
    setQuizOrderUserIds(ids);
  }, []);

  return {
    roundState,
    roundIndex,
    timerSeconds,
    showRestartConfirm,
    setShowRestartConfirm,
    showExitConfirm,
    setShowExitConfirm,
    showRulesOverlay,
    setShowRulesOverlay,
    isStartCinematic,
    upcomingRoundTitle,
    visibleHintLineCount,
    gamePaused,
    gesturePauseLayout,
    orderedRounds,
    round,
    roundPhotoBackground,
    roundVideoBackgroundUrl,
    roundVideoBackgroundStart,
    roundYoutubeBackgroundEmbed,
    hintLines,
    revealLines,
    startQuiz,
    skipIntroAndGoToRules,
    onIntroVideoEnded,
    skipRulesAndStart,
    toggleGamePause,
    replaySnippet,
    handleRevealClick,
    nextRound,
    exitToStartScreen,
    returnToModeSelect,
    previewMode: !!previewRound,
    previewLoading,
    gameMode,
    quizScore,
    quizOptions,
    quizUiVariant,
    quizOrderUserIds,
    reorderQuizOrderLines,
    quizCorrectIndex,
    selectedQuizIndex,
    setQuizSelection,
    confirmQuizRound,
    selectGameMode,
    quizEligibleCount,
    outroVideoSrc,
    skipGameRulesToModeSelect,
  };
}

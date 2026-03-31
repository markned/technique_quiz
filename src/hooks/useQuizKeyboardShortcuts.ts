import { useEffect, type MutableRefObject } from "react";
import type { GameMode, RoundState } from "../types";

/**
 * Горячие клавиши основного экрана викторины (Escape / R / стрелка / пробел).
 * Логика перенесена из useQuizGame без изменений.
 */
export function useQuizKeyboardShortcuts(options: {
  isQuizMainView: boolean;
  showRestartConfirm: boolean;
  showExitConfirm: boolean;
  showRulesOverlay: boolean;
  setShowRulesOverlay: (open: boolean) => void;
  roundStateRef: MutableRefObject<RoundState>;
  gameModeRef: MutableRefObject<GameMode | null>;
  gamePausedRef: MutableRefObject<boolean>;
  toggleGamePauseRef: MutableRefObject<() => void>;
  replaySnippetRef: MutableRefObject<() => void>;
  nextRoundRef: MutableRefObject<() => void>;
  confirmQuizRoundRef: MutableRefObject<() => void>;
  handleRevealClickRef: MutableRefObject<() => void>;
}): void {
  const {
    isQuizMainView,
    showRestartConfirm,
    showExitConfirm,
    showRulesOverlay,
    setShowRulesOverlay,
    roundStateRef,
    gameModeRef,
    gamePausedRef,
    toggleGamePauseRef,
    replaySnippetRef,
    nextRoundRef,
    confirmQuizRoundRef,
    handleRevealClickRef,
  } = options;

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
  }, [isQuizMainView, showRestartConfirm, showExitConfirm, showRulesOverlay, setShowRulesOverlay]);
}

import { assetUrl } from "../helpers/quizConfig";
import { useCoarsePointer } from "../hooks/useCoarsePointer";
import { useGesturePauseLayout } from "../hooks/useGesturePauseLayout";
import type { QuizUiVariant } from "../helpers/quizOptions";
import type { GameMode } from "../types";

type GamePauseToggleProps = {
  restartLabel?: string;
  paused: boolean;
  disabled: boolean;
  onToggle: () => void;
  /** Без кнопки: пауза жестом (два пальца) или пробел; при паузе — большая иконка */
  touchMode: boolean;
  gameMode: GameMode | null;
  quizUiVariant: QuizUiVariant | null;
  onReturnToModeSelectRequest: () => void;
  onExitToStart: () => void;
  onRulesRequest: () => void;
};

function PauseHintsPanel({
  gameMode,
  quizUiVariant,
}: {
  gameMode: GameMode | null;
  quizUiVariant: QuizUiVariant | null;
}) {
  const coarse = useCoarsePointer();
  const gesturePause = useGesturePauseLayout();

  const pauseHint = !gesturePause
    ? "Пауза: кнопка ⏸ или Esc"
    : coarse
      ? "Пауза: два пальца на экране"
      : "Пауза: Esc";

  return (
    <div className="game-pause-hints" aria-hidden>
      <div className="game-pause-hint game-pause-hint--pulse">
        <span className="game-pause-hint-anim" />
        <span>{pauseHint}</span>
      </div>
      <div className="game-pause-hint game-pause-hint--wiggle">
        <span className="game-pause-hint-anim" />
        <span>R — повтор фрагмента</span>
      </div>
      {gameMode === "quiz" ? (
        <div className="game-pause-hint game-pause-hint--shake">
          <span className="game-pause-hint-anim" />
          <span>
            {quizUiVariant === "order"
              ? "Викторина: порядок строк — перетащите или ✓ / пробел"
              : "Викторина: выбери из 4 — вариант, ✓ или пробел"}
          </span>
        </div>
      ) : (
        <div className="game-pause-hint game-pause-hint--shake">
          <span className="game-pause-hint-anim" />
          <span>Фристайл: продолжи вслух, затем пробел или 👁</span>
        </div>
      )}
    </div>
  );
}

export function GamePauseToggle({
  restartLabel = "К режимам",
  paused,
  disabled,
  onToggle,
  touchMode,
  gameMode,
  quizUiVariant,
  onReturnToModeSelectRequest,
  onExitToStart,
  onRulesRequest,
}: GamePauseToggleProps) {
  return (
    <>
      {paused ? (
        <div className="game-pause-layer">
          <div className="game-pause-scrim" aria-hidden />
          <div className="game-pause-icon-stage">
            <button
              type="button"
              className="game-pause-start-icon-wrap"
              onClick={onToggle}
              disabled={disabled}
              aria-label="Продолжить игру"
            >
              <img
                src={assetUrl("/content/icons/pause-icon.png")}
                alt=""
                className="start-icon"
                draggable={false}
              />
            </button>
            <PauseHintsPanel gameMode={gameMode} quizUiVariant={quizUiVariant} />
            <div className="game-pause-menu">
              <button
                type="button"
                className="game-pause-menu-btn game-pause-menu-btn--accent"
                onClick={onRulesRequest}
              >
                Правила
              </button>
              <button
                type="button"
                className="game-pause-menu-btn game-pause-menu-btn--secondary"
                onClick={onReturnToModeSelectRequest}
              >
                {restartLabel}
              </button>
              <button type="button" className="game-pause-menu-btn" onClick={onExitToStart}>
                Выйти
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {!touchMode ? (
        <button
          type="button"
          className="game-pause-toggle"
          disabled={disabled}
          onClick={onToggle}
          aria-pressed={paused}
          aria-label={paused ? "Продолжить игру" : "Пауза"}
          title={paused ? "Продолжить" : "Пауза"}
        >
          {paused ? "▶" : "⏸"}
        </button>
      ) : null}
    </>
  );
}

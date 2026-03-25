import { assetUrl } from "../helpers/quizConfig";

type GamePauseToggleProps = {
  paused: boolean;
  disabled: boolean;
  onToggle: () => void;
  /** Без кнопки: пауза жестом (два пальца) или пробел; при паузе — большая иконка */
  touchMode: boolean;
  onRestartRequest: () => void;
  onExitToStart: () => void;
};

export function GamePauseToggle({
  paused,
  disabled,
  onToggle,
  touchMode,
  onRestartRequest,
  onExitToStart,
}: GamePauseToggleProps) {
  return (
    <>
      {paused ? (
        <div className="game-pause-layer">
          <div className="game-pause-scrim" aria-hidden />
          <div className="game-pause-icon-stage">
            <div className="game-pause-start-icon-wrap" aria-hidden>
              <img
                src={assetUrl("/content/photos/start-icon.png")}
                alt=""
                className="start-icon"
                draggable={false}
              />
            </div>
            <div className="game-pause-menu">
              <button
                type="button"
                className="game-pause-menu-btn"
                onClick={onRestartRequest}
              >
                Перезапуск
              </button>
              <button
                type="button"
                className="game-pause-menu-btn game-pause-menu-btn--secondary"
                onClick={onExitToStart}
              >
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

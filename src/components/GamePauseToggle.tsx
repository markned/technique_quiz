type GamePauseToggleProps = {
  paused: boolean;
  disabled?: boolean;
  onToggle: () => void;
};

export function GamePauseToggle({ paused, disabled, onToggle }: GamePauseToggleProps) {
  return (
    <>
      {paused ? <div className="game-pause-scrim" aria-hidden /> : null}
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
    </>
  );
}

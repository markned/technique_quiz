import { StartScreen } from "./StartScreen";

type StartChoiceScreenProps = {
  onSingleplayer: () => void;
  onMultiplayer: () => void;
};

export function StartChoiceScreen({ onSingleplayer, onMultiplayer }: StartChoiceScreenProps) {
  return (
    <div className="start-screen-layout">
      <StartScreen onStart={onSingleplayer} />
      <div className="start-choice-actions" aria-label="Выбор режима игры">
        <button type="button" className="btn btn-primary btn-hero" onClick={onSingleplayer}>
          Singleplayer
        </button>
        <button type="button" className="btn btn-hero" onClick={onMultiplayer}>
          Multiplayer
        </button>
      </div>
    </div>
  );
}

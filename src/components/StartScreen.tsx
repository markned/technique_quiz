import { assetUrl } from "../helpers/quizConfig";

type StartScreenProps = {
  onStart: () => void;
};

export function StartScreen({ onStart }: StartScreenProps) {
  return (
    <div className="start-screen start-screen-icon" onClick={onStart}>
      <img
        src={assetUrl("/content/photos/start-icon.png")}
        alt="Начать"
        className="start-icon"
      />
    </div>
  );
}

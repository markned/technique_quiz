import { MODE_SELECT_FREESTYLE_VIDEO, MODE_SELECT_QUIZ_VIDEO } from "../helpers/quizConfig";
import { boostVolume } from "../lib/volumeBoost";

type MainModeChoiceScreenProps = {
  onSingleplayer: () => void;
  onMultiplayer: () => void;
};

function ChoicePane({
  videoSrc,
  tint,
  title,
  description,
  onSelect,
}: {
  videoSrc: string;
  tint: "green" | "red";
  title: string;
  description: string;
  onSelect: () => void;
}) {
  const handlePlay = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    boostVolume(event.currentTarget);
  };

  return (
    <button
      type="button"
      className={`mode-select-pane mode-select-pane--${tint}`}
      onClick={onSelect}
      aria-label={title}
    >
      <video
        className="mode-select-pane__video"
        src={videoSrc}
        playsInline
        muted
        autoPlay
        loop
        preload="auto"
        onPlay={handlePlay}
      />
      <div className={`mode-select-pane__tint mode-select-pane__tint--${tint}`} aria-hidden />
      <div className="mode-select-pane__content main-mode-choice-content">
        <p className="main-mode-choice-eyebrow">Выбор игры</p>
        <h2 className="mode-select-pane__title">{title}</h2>
        <p className="mode-select-pane__desc">{description}</p>
      </div>
    </button>
  );
}

export function MainModeChoiceScreen({ onSingleplayer, onMultiplayer }: MainModeChoiceScreenProps) {
  return (
    <main className="mode-select-shell main-mode-choice-shell">
      <div className="mode-select-split">
        <ChoicePane
          videoSrc={MODE_SELECT_QUIZ_VIDEO}
          tint="red"
          title="Один игрок"
          description="Классическая викторина: только режим с вариантами и порядком строк."
          onSelect={onSingleplayer}
        />
        <ChoicePane
          videoSrc={MODE_SELECT_FREESTYLE_VIDEO}
          tint="green"
          title="Мультиплеер"
          description="Телефоны как контроллеры, главный экран показывает код комнаты."
          onSelect={onMultiplayer}
        />
      </div>
    </main>
  );
}

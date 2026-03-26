import { OUTRO_VIDEO_PATH } from "../helpers/quizConfig";
import { boostVolume } from "../lib/volumeBoost";

type OutroScreenProps = {
  onRestart: () => void;
  onExitToStart: () => void;
};

export function OutroScreen({ onRestart, onExitToStart }: OutroScreenProps) {
  const onPlay = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    video.muted = false;
    boostVolume(video);
  };

  return (
    <main className="app-shell outro-video-shell">
      <video
        className="intro-outro-video intro-outro-foreground"
        src={OUTRO_VIDEO_PATH}
        autoPlay
        playsInline
        muted
        loop
        onPlay={onPlay}
      />
      <div className="outro-actions">
        <button type="button" className="outro-restart-btn" onClick={onRestart} title="Перезапустить" aria-label="Перезапустить">
          ↻
        </button>
        <button
          type="button"
          className="outro-menu-btn"
          onClick={onExitToStart}
          title="В меню"
          aria-label="Выйти в меню"
        >
          <span aria-hidden>✕</span>
        </button>
      </div>
    </main>
  );
}

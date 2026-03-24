import { OUTRO_VIDEO_PATH } from "../helpers/quizConfig";
import { boostVolume } from "../lib/volumeBoost";

type OutroScreenProps = {
  onRestart: () => void;
};

export function OutroScreen({ onRestart }: OutroScreenProps) {
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
      <button className="outro-restart-btn" onClick={onRestart} title="Перезапустить">
        ↻
      </button>
    </main>
  );
}

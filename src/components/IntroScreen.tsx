import { useTripleTap } from "../hooks/useTripleTap";
import { INTRO_VIDEO_PATH } from "../helpers/quizConfig";
import { boostVolume } from "../lib/volumeBoost";

type IntroScreenProps = {
  onVideoEnded: () => void;
  onSkip: () => void;
};

export function IntroScreen({ onVideoEnded, onSkip }: IntroScreenProps) {
  const handleTripleTap = useTripleTap(onSkip);

  const onPlay = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    video.muted = false;
    boostVolume(video);
  };

  return (
    <main className="app-shell intro-video-shell" onClick={handleTripleTap}>
      <video
        className="intro-outro-video intro-outro-foreground"
        src={INTRO_VIDEO_PATH}
        autoPlay
        playsInline
        muted
        onPlay={onPlay}
        onEnded={onVideoEnded}
      />
      <p className="intro-skip-hint">Тройной тап — пропустить</p>
    </main>
  );
}

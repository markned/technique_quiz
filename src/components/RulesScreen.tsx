import { useEffect, useRef } from "react";
import { useTripleTap } from "../hooks/useTripleTap";
import { GAME_RULES } from "../content/rules";
import { RULES_AUDIO_DELAY_MS, RULES_AUDIO_PATH } from "../helpers/quizConfig";
import { boostVolume } from "../lib/volumeBoost";

type RulesScreenProps = {
  onComplete: () => void;
};

export function RulesScreen({ onComplete }: RulesScreenProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const handleTripleTap = useTripleTap(onComplete);

  useEffect(() => {
    const t = setTimeout(() => {
      const audio = new Audio(RULES_AUDIO_PATH);
      audioRef.current = audio;
      boostVolume(audio);
      audio.play().catch(() => {});
      audio.addEventListener("ended", onComplete);
    }, RULES_AUDIO_DELAY_MS);
    return () => {
      clearTimeout(t);
      audioRef.current?.pause();
    };
  }, [onComplete]);

  return (
    <main
      className="app-shell rules-screen-shell"
      onClick={handleTripleTap}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onComplete()}
    >
      <div className="rules-screen-card">
        <h2 className="rules-screen-title">Правила игры</h2>
        <pre className="rules-screen-text">{GAME_RULES}</pre>
        <p className="rules-screen-hint">Тройной тап — пропустить</p>
      </div>
    </main>
  );
}

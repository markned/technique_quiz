import { useEffect, useRef } from "react";
import { useFitTextToHeight } from "../hooks/useFitTextToHeight";
import { useTripleTap } from "../hooks/useTripleTap";
import { GAME_RULES } from "../content/rules";
import { RULES_AUDIO_DELAY_MS, RULES_AUDIO_PATH } from "../helpers/quizConfig";
import { boostRulesNarration } from "../lib/volumeBoost";

type RulesScreenProps = {
  onComplete: () => void;
};

export function RulesScreen({ onComplete }: RulesScreenProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const handleTripleTap = useTripleTap(onComplete);
  const { containerRef, textRef } = useFitTextToHeight({ maxPx: 44, floorMinPx: 8 });

  useEffect(() => {
    const t = setTimeout(() => {
      const audio = new Audio(RULES_AUDIO_PATH);
      audioRef.current = audio;
      boostRulesNarration(audio);
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
        <div ref={containerRef} className="rules-screen-body">
          <pre ref={textRef} className="rules-screen-text">
            {GAME_RULES}
          </pre>
        </div>
        <p className="rules-screen-hint">Тройной тап — пропустить</p>
      </div>
    </main>
  );
}

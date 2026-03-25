import { useEffect, useRef } from "react";
import { useFitTextToHeight } from "../hooks/useFitTextToHeight";
import { GAME_RULES } from "../content/rules";
import { RULES_AUDIO_DELAY_MS, RULES_AUDIO_PATH } from "../helpers/quizConfig";
import { whenAudioUnlocked } from "../lib/audioUnlock";
import { boostRulesNarration } from "../lib/volumeBoost";

type RulesScreenProps = {
  onComplete: () => void;
};

export function RulesScreen({ onComplete }: RulesScreenProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { containerRef, textRef } = useFitTextToHeight({ maxPx: 44, floorMinPx: 8 });

  useEffect(() => {
    let cancelled = false;
    let cancelPendingPlay: (() => void) | undefined;

    const startPlayback = () => {
      if (cancelled) return;
      const audio = new Audio(RULES_AUDIO_PATH);
      audioRef.current = audio;
      boostRulesNarration(audio);
      const tryPlay = () => {
        void audio.play().catch(() => {
          if (cancelled) return;
          cancelPendingPlay?.();
          cancelPendingPlay = whenAudioUnlocked(() => {
            if (cancelled) return;
            void audio.play().catch(() => {});
          });
        });
      };
      tryPlay();
    };

    const t = window.setTimeout(() => {
      if (!cancelled) startPlayback();
    }, RULES_AUDIO_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
      cancelPendingPlay?.();
      audioRef.current?.pause();
    };
  }, []);

  return (
    <main className="app-shell rules-screen-shell">
      <div className="rules-screen-card">
        <h2 className="rules-screen-title">Правила игры</h2>
        <div ref={containerRef} className="rules-screen-body">
          <pre ref={textRef} className="rules-screen-text">
            {GAME_RULES}
          </pre>
        </div>
        <div className="rules-screen-start-wrap">
          <button
            type="button"
            className="rules-screen-start-btn"
            onClick={onComplete}
            aria-label="Начать викторину"
          >
            →
          </button>
        </div>
      </div>
    </main>
  );
}

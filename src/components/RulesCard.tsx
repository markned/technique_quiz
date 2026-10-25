import { useEffect, useRef, type ReactNode } from "react";
import { GameRulesCommon } from "../content/rules";
import { RULES_AUDIO_DELAY_MS } from "../helpers/quizConfig";
import type { GameMode } from "../types";
import { whenAudioUnlocked } from "../lib/audioUnlock";
import { boostRulesNarration } from "../lib/volumeBoost";

type RulesCardProps = {
  footer: ReactNode;
  /** Озвучка `audioSrc` (по умолчанию выключена — общий экран без автозвука) */
  playAudio?: boolean;
  /** Текст правил (по умолчанию общие правила с подсказками по режимам) */
  rulesContent?: ReactNode;
  /** Заголовок карточки */
  rulesTitle?: string;
  /** Путь к озвучке (нужен, если `playAudio`) */
  audioSrc?: string;
  /** Режим для разметки / aria */
  mode?: GameMode | "common";
};

/** Текст правил + опциональная озвучка; подвал (→ или ✕) задаётся снаружи */
export function RulesCard({
  footer,
  playAudio = false,
  rulesContent = <GameRulesCommon />,
  rulesTitle = "Правила игры",
  audioSrc,
  mode = "freestyle",
}: RulesCardProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!playAudio || !audioSrc) {
      return;
    }
    let cancelled = false;
    let cancelPendingPlay: (() => void) | undefined;

    const startPlayback = () => {
      if (cancelled) return;
      const audio = new Audio(audioSrc);
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
  }, [playAudio, audioSrc]);

  return (
    <div className="rules-screen-card">
      <p className="rules-step">Technique Quiz · Правила</p>
      <h2 id="rules-title" className="rules-screen-title">
        {rulesTitle}
      </h2>
      <div className="rules-screen-body">
        <div className="rules-screen-text" data-rules-mode={mode}>
          {rulesContent}
        </div>
      </div>
      {footer}
    </div>
  );
}

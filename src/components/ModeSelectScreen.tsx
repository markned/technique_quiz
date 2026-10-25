import { useCallback, useEffect } from "react";
import { useModeSelectMobileDemo } from "../hooks/useModeSelectMobileDemo";
import { MODE_SELECT_FREESTYLE_VIDEO, MODE_SELECT_QUIZ_VIDEO } from "../helpers/quizConfig";
import { prefersHover } from "../lib/mediaQueries";
import { pauseModeSelectPreview, playModeSelectPreview } from "../lib/modeSelectPaneVideo";
import { boostVolume } from "../lib/volumeBoost";
import type { GameMode } from "../types";

type ModeSelectScreenProps = {
  onSelectMode: (mode: GameMode) => void;
  quizEligibleCount: number;
  multiplayer?: boolean;
  connectedPlayers?: number;
};

type Tint = "green" | "red";

type ModeSelectPaneProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoSrc: string;
  tint: Tint;
  title: string;
  description: string;
  disabled?: boolean;
  disabledHint?: string;
  onSelect: () => void;
  demoActive?: boolean;
  onVideoEnded?: () => void;
};

function ModeSelectPane({
  videoRef,
  videoSrc,
  tint,
  title,
  description,
  disabled,
  disabledHint,
  onSelect,
  demoActive,
  onVideoEnded,
}: ModeSelectPaneProps) {
  const pauseVideo = useCallback(() => {
    pauseModeSelectPreview(videoRef.current);
  }, [videoRef]);

  const playVideo = useCallback(() => {
    if (disabled) return;
    playModeSelectPreview(videoRef.current);
  }, [disabled, videoRef]);

  useEffect(() => {
    return () => pauseVideo();
  }, [pauseVideo]);

  const handlePointerEnter = () => {
    if (disabled) return;
    if (prefersHover()) playVideo();
  };

  const handlePointerLeave = () => {
    if (prefersHover()) pauseVideo();
  };

  const handlePlay = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    boostVolume(e.currentTarget);
  };

  const paneClass =
    `mode-select-pane mode-select-pane--${tint}` +
    (disabled ? " mode-select-pane--disabled" : "") +
    (demoActive ? " mode-select-pane--demo-active" : "");

  return (
    <button
      type="button"
      className={paneClass}
      onClick={() => {
        if (!disabled) onSelect();
      }}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      disabled={disabled}
      aria-disabled={disabled}
    >
      <video
        ref={videoRef as React.Ref<HTMLVideoElement>}
        className="mode-select-pane__video"
        src={videoSrc}
        playsInline
        muted
        preload="auto"
        onPlay={handlePlay}
        onEnded={onVideoEnded}
      />
      <div className={`mode-select-pane__tint mode-select-pane__tint--${tint}`} aria-hidden />
      <div className="mode-select-pane__content">
        <h2 className="mode-select-pane__title">{title}</h2>
        <p className="mode-select-pane__desc">{description}</p>
        {disabled && disabledHint ? <p className="mode-select-pane__warn">{disabledHint}</p> : null}
      </div>
    </button>
  );
}

export function ModeSelectScreen({
  onSelectMode,
  quizEligibleCount,
  multiplayer = false,
  connectedPlayers = 0,
}: ModeSelectScreenProps) {
  const quizDisabled = quizEligibleCount < 4 || (multiplayer && connectedPlayers < 2);
  const demo = useModeSelectMobileDemo(quizDisabled);

  const shellClass = "mode-select-shell" + (demo.isMobileDemo ? " mode-select-shell--mobile-demo" : "");

  return (
    <main className={shellClass}>
      <div className="mode-select-split">
        <ModeSelectPane
          videoRef={demo.freestyleRef}
          videoSrc={MODE_SELECT_FREESTYLE_VIDEO}
          tint="green"
          title="Фристайл"
          disabled={multiplayer && connectedPlayers < 3}
          disabledHint="Фристайл — от 3 игроков."
          description={multiplayer ? "Напиши продолжение и проголосуй" : "Продолжи строчки вслух"}
          onSelect={() => onSelectMode("freestyle")}
          demoActive={demo.demoActiveFreestyle}
          onVideoEnded={demo.onDemoEndedFreestyle}
        />
        <ModeSelectPane
          videoRef={demo.quizRef}
          videoSrc={MODE_SELECT_QUIZ_VIDEO}
          tint="red"
          title="Викторина"
          description={multiplayer ? "Выбери ответ на своём устройстве" : "Выбери ответ"}
          disabled={quizDisabled}
          disabledHint={
            multiplayer && connectedPlayers < 2
              ? "Викторина — от 2 игроков."
              : `Нужно минимум 4 раунда с ответом хотя бы из одной строки (сейчас ${quizEligibleCount}).`
          }
          onSelect={() => onSelectMode("quiz")}
          demoActive={demo.demoActiveQuiz}
          onVideoEnded={demo.onDemoEndedQuiz}
        />
      </div>
    </main>
  );
}

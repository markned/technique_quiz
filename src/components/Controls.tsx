import { useRef } from "react";
import { useDockFitScale } from "../hooks/useDockFitScale";
import type { RoundState } from "../types";

type ControlsProps = {
  roundState: RoundState;
  onReplaySnippet: () => void;
  onReveal: () => void;
  onNextRound: () => void;
  onRestartRequest: () => void;
};

export function Controls({
  roundState,
  onReplaySnippet,
  onReveal,
  onNextRound,
  onRestartRequest,
}: ControlsProps) {
  const dockRef = useRef<HTMLElement>(null);
  useDockFitScale(dockRef);

  const canReveal = roundState === "timer_finished";
  const canNext = roundState === "reveal";
  const canReplay = roundState !== "transition";

  return (
    <div className="dock-host">
      <nav ref={dockRef} className="dock" role="toolbar">
      <button
        type="button"
        className="dock-btn"
        onClick={onReplaySnippet}
        disabled={!canReplay}
        title="Повторить фрагмент"
      >
        ▶
      </button>
      <button
        className={`dock-btn dock-btn-primary ${canReveal ? "" : "dock-btn-dimmed"}`}
        onClick={onReveal}
        title={canReveal ? "Открыть ответ" : "Тройной клик — выскрыть ответ"}
      >
        👁
      </button>
      <button
        className={`dock-btn dock-btn-primary ${canNext ? "" : "dock-btn-dimmed"}`}
        onClick={onNextRound}
        disabled={!canNext}
        title="Следующий раунд"
      >
        →
      </button>
      <button className="dock-btn dock-btn-danger" onClick={onRestartRequest} title="Перезапуск">
        ↻
      </button>
    </nav>
    </div>
  );
}

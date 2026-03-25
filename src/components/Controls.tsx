import { useRef } from "react";
import { ReplayWithPlayIcon } from "./ReplayWithPlayIcon";
import { useDockFitScale } from "../hooks/useDockFitScale";
import type { RoundState } from "../types";

type ControlsProps = {
  roundState: RoundState;
  onReplaySnippet: () => void;
  onReveal: () => void;
  onNextRound: () => void;
};

export function Controls({
  roundState,
  onReplaySnippet,
  onReveal,
  onNextRound,
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
        className="dock-btn dock-btn-replay"
        onClick={onReplaySnippet}
        disabled={!canReplay}
        title="Повторить фрагмент (R)"
      >
        <ReplayWithPlayIcon />
      </button>
      <button
        className={`dock-btn dock-btn-primary ${canReveal ? "" : "dock-btn-dimmed"}`}
        onClick={onReveal}
        title={canReveal ? "Открыть ответ (пробел)" : "Тройной клик или пробел — вскрыть ответ"}
      >
        👁
      </button>
      <button
        className={`dock-btn dock-btn-primary ${canNext ? "" : "dock-btn-dimmed"}`}
        onClick={onNextRound}
        disabled={!canNext}
        title="Следующий раунд (→)"
      >
        →
      </button>
    </nav>
    </div>
  );
}

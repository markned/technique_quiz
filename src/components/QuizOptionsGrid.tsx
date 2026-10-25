import { memo } from "react";
import type { RoundState } from "../types";

function optionLabel(text: string) {
  const raw = text || "—";
  const parts = raw.split("\n");
  if (parts.length === 1) return raw;
  return parts.map((part, j) => (
    <span key={j} className="quiz-option-segment">
      {part.length ? part : " "}
    </span>
  ));
}

type QuizOptionsGridProps = {
  options: string[];
  selectedIndex: number | null;
  correctIndex: number;
  onSelect: (index: number) => void;
  roundState: RoundState;
  disabled: boolean;
  displayOnly?: boolean;
};

export const QuizOptionsGrid = memo(function QuizOptionsGrid({
  options,
  selectedIndex,
  correctIndex,
  onSelect,
  roundState,
  disabled,
  displayOnly = false,
}: QuizOptionsGridProps) {
  const isFeedback = roundState === "quiz_feedback";
  const visible = (roundState === "paused_for_guess" || isFeedback) && options.length === 4;
  if (!visible) return null;

  return (
    <section className="quiz-options-panel genius-style" role="group" aria-label="Варианты ответа">
      <div className="quiz-options-grid">
        {options.map((text, i) => {
          let cls = "lyric-line genius-bar quiz-option";
          if (!isFeedback) {
            if (selectedIndex !== i) cls += " quiz-option--shake";
            if (selectedIndex === i) cls += " quiz-option--selected";
          } else {
            cls += " quiz-option--feedback";
            if (i === correctIndex) {
              cls += " quiz-option--correct";
            } else if (selectedIndex !== null && i === selectedIndex) {
              cls += " quiz-option--wrong";
            } else {
              cls += " quiz-option--dim";
            }
          }
          if (displayOnly)
            return (
              <div key={i} className={cls} style={{ cursor: "default" }}>
                {optionLabel(text)}
              </div>
            );
          return (
            <button
              key={i}
              type="button"
              className={cls}
              disabled={disabled || isFeedback}
              aria-pressed={!isFeedback && selectedIndex === i ? true : false}
              onClick={() => onSelect(i)}
            >
              {optionLabel(text)}
            </button>
          );
        })}
      </div>
    </section>
  );
});

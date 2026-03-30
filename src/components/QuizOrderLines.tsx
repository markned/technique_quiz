import { Reorder } from "framer-motion";
import type { RoundState } from "../types";

type QuizOrderLinesProps = {
  roundState: RoundState;
  orderedIds: number[];
  lineText: (id: number) => string;
  correctIds: number[];
  disabled: boolean;
  onReorder: (ids: number[]) => void;
};

export function QuizOrderLines({
  roundState,
  orderedIds,
  lineText,
  correctIds,
  disabled,
  onReorder,
}: QuizOrderLinesProps) {
  const isFeedback = roundState === "quiz_feedback";
  const visible = (roundState === "paused_for_guess" || isFeedback) && orderedIds.length >= 3;
  if (!visible) return null;

  const dragEnabled = !disabled && !isFeedback;

  const move = (from: number, to: number) => {
    if (from === to || disabled || isFeedback) return;
    const next = [...orderedIds];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onReorder(next);
  };

  return (
    <section className="quiz-options-panel genius-style quiz-order-panel" aria-label="Порядок строк ответа">
      <Reorder.Group
        axis="y"
        as="ol"
        className="quiz-order-list"
        values={orderedIds}
        onReorder={onReorder}
      >
        {orderedIds.map((id, idx) => {
          const ok = isFeedback && correctIds[idx] === id;
          const rowCls =
            "lyric-line genius-bar quiz-option quiz-order-row" +
            (!isFeedback ? " quiz-option--shake" : "") +
            (isFeedback ? " quiz-option--feedback" : "") +
            (isFeedback && ok ? " quiz-option--correct" : "") +
            (isFeedback && !ok ? " quiz-option--wrong" : "");
          return (
            <Reorder.Item
              key={id}
              value={id}
              as="li"
              className="quiz-order-li"
              drag={dragEnabled}
              layout="position"
              transition={{ type: "spring", stiffness: 520, damping: 38 }}
            >
              <div className={rowCls}>
                {!isFeedback ? (
                  <span className="quiz-order-grip" aria-hidden title="Перетащить строку">
                    <span className="quiz-order-grip__dots" />
                  </span>
                ) : null}
                <span className="quiz-order-row__text">{lineText(id) || "—"}</span>
                {!isFeedback ? (
                  <div className="quiz-order-row__nudges">
                    <button
                      type="button"
                      className="quiz-order-nudge"
                      disabled={disabled || idx === 0}
                      onClick={() => move(idx, idx - 1)}
                      aria-label="Переместить строку вверх"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="quiz-order-nudge"
                      disabled={disabled || idx >= orderedIds.length - 1}
                      onClick={() => move(idx, idx + 1)}
                      aria-label="Переместить строку вниз"
                    >
                      ↓
                    </button>
                  </div>
                ) : null}
              </div>
            </Reorder.Item>
          );
        })}
      </Reorder.Group>
    </section>
  );
}

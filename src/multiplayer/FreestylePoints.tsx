import type { FreestyleRoundResult } from "./types";

export function FreestylePoints({
  submission,
  threshold,
}: {
  submission: FreestyleRoundResult["submissions"][number];
  threshold: number;
}) {
  return (
    <div className="multiplayer-score-breakdown" aria-label="Начисление очков">
      <p className="multiplayer-similarity">
        Схожесть {Math.floor(submission.similarity * 100)}% · от {Math.round(threshold * 100)}% — +1
      </p>
      <div className="multiplayer-score-badges">
        <span className={`multiplayer-score-badge ${submission.tieBrokenWinner ? "is-earned" : ""}`}>
          +{Number(submission.tieBrokenWinner)} за голосование
        </span>
        <span className={`multiplayer-score-badge ${submission.similarityBonus ? "is-earned" : ""}`}>
          +{Number(submission.similarityBonus)} за оригинал
        </span>
      </div>
    </div>
  );
}

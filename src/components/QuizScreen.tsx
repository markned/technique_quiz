import type { LyricLine, Round, RoundState } from "../types";
import { Controls } from "./Controls";
import { LyricsPanel } from "./LyricsPanel";
import { RevealPanel } from "./RevealPanel";
import { Timer } from "./Timer";

type QuizScreenProps = {
  round: Round;
  roundIndex: number;
  totalRounds: number;
  roundState: RoundState;
  hintLines: LyricLine[];
  revealLines: LyricLine[];
  visibleHintLineCount: number;
  timerSeconds: number;
  totalSeconds: number;
  onReplaySnippet: () => void;
  onReveal: () => void;
  onNextRound: () => void;
};

export function QuizScreen(props: QuizScreenProps) {
  const {
    round,
    roundIndex,
    totalRounds,
    roundState,
    hintLines,
    revealLines,
    visibleHintLineCount,
    timerSeconds,
    totalSeconds,
    onReplaySnippet,
    onReveal,
    onNextRound,
  } = props;

  const revealVisible = roundState === "reveal";
  const timerActive = roundState === "paused_for_guess";
  const showLyrics = roundState !== "transition";

  return (
    <div className="quiz-screen">
      <header className="quiz-header">
        <span className="quiz-round-counter">
          {roundIndex + 1}/{totalRounds}
        </span>
        <div className="quiz-header-timer">
          <Timer seconds={timerSeconds} isActive={timerActive} totalSeconds={totalSeconds} />
        </div>
      </header>
      <div className="quiz-content">
        {showLyrics ? (
          <>
            <h2 className="quiz-title">{round.title}</h2>
            <LyricsPanel hintLines={hintLines} visibleCount={visibleHintLineCount} />
            <RevealPanel revealLines={revealLines} visible={revealVisible} />
          </>
        ) : null}
      </div>
      <Controls
        roundState={roundState}
        onReplaySnippet={onReplaySnippet}
        onReveal={onReveal}
        onNextRound={onNextRound}
      />
    </div>
  );
}

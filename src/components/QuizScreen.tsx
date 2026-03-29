import type { QuizUiVariant } from "../helpers/quizOptions";
import type { GameMode, LyricLine, Round, RoundState } from "../types";
import { useQuizContentFit } from "../hooks/useQuizContentFit";
import { roundCounterEasterEggLabel } from "../helpers/roundCounterEasterEgg";
import { Controls } from "./Controls";
import { LyricsPanel } from "./LyricsPanel";
import { QuizModeHint } from "./QuizModeHint";
import { QuizOptionsGrid } from "./QuizOptionsGrid";
import { QuizOrderLines } from "./QuizOrderLines";
import { RevealPanel } from "./RevealPanel";
import { Timer } from "./Timer";

type QuizScreenProps = {
  round: Round;
  roundIndex: number;
  totalRounds: number;
  roundState: RoundState;
  gameMode: GameMode | null;
  quizScore: number;
  quizOptions: string[];
  quizUiVariant: QuizUiVariant | null;
  quizOrderUserIds: number[];
  onReorderQuizOrder: (ids: number[]) => void;
  quizCorrectIndex: number;
  selectedQuizIndex: number | null;
  onSelectQuizOption: (index: number) => void;
  hintLines: LyricLine[];
  revealLines: LyricLine[];
  visibleHintLineCount: number;
  timerSeconds: number;
  totalSeconds: number;
  gamePaused: boolean;
  onReplaySnippet: () => void;
  onReveal: () => void;
  onConfirmQuiz: () => void;
  onNextRound: () => void;
};

export function QuizScreen(props: QuizScreenProps) {
  const {
    round,
    roundIndex,
    totalRounds,
    roundState,
    gameMode,
    quizScore,
    quizOptions,
    quizUiVariant,
    quizOrderUserIds,
    onReorderQuizOrder,
    quizCorrectIndex,
    selectedQuizIndex,
    onSelectQuizOption,
    hintLines,
    revealLines,
    visibleHintLineCount,
    timerSeconds,
    totalSeconds,
    gamePaused,
    onReplaySnippet,
    onReveal,
    onConfirmQuiz,
    onNextRound,
  } = props;

  const revealVisible = roundState === "reveal";
  const timerActive = roundState === "paused_for_guess";
  const showLyrics = roundState !== "transition";
  const counterLabel = roundCounterEasterEggLabel(round) ?? `${roundIndex + 1}/${totalRounds}`;
  const lineText = (id: number) => round.lyrics.find((l) => l.id === id)?.text ?? "";
  const quizHintVisible =
    gameMode === "quiz" &&
    quizUiVariant === "order" &&
    (roundState === "playing" || roundState === "paused_for_guess");

  const { containerRef: quizFitOuterRef, innerRef: quizFitInnerRef } = useQuizContentFit();

  return (
    <div className="quiz-screen">
      <header className="quiz-header">
        <span className="quiz-round-counter">
          {counterLabel}
          {gameMode === "quiz" ? (
            <span className="quiz-score-pill" aria-live="polite">
              · ✓ {quizScore}
            </span>
          ) : null}
        </span>
        <div className="quiz-header-timer">
          <Timer seconds={timerSeconds} isActive={timerActive} totalSeconds={totalSeconds} />
        </div>
      </header>
      <div className="quiz-content">
        <div ref={quizFitOuterRef} className="quiz-content-fit-outer">
          <div ref={quizFitInnerRef} className="quiz-content-fit-inner">
            {showLyrics ? (
              <>
                <h2 className="quiz-title">{round.title}</h2>
                <QuizModeHint variant={quizUiVariant} visible={quizHintVisible} />
                <LyricsPanel hintLines={hintLines} visibleCount={visibleHintLineCount} />
                <QuizOrderLines
                  roundState={roundState}
                  orderedIds={quizOrderUserIds}
                  lineText={lineText}
                  correctIds={round.revealLineIds}
                  disabled={gamePaused}
                  onReorder={onReorderQuizOrder}
                />
                <QuizOptionsGrid
                  options={quizOptions}
                  selectedIndex={selectedQuizIndex}
                  correctIndex={quizCorrectIndex}
                  onSelect={onSelectQuizOption}
                  roundState={roundState}
                  disabled={gamePaused}
                />
                <RevealPanel revealLines={revealLines} visible={revealVisible} />
              </>
            ) : null}
          </div>
        </div>
      </div>
      <Controls
        roundState={roundState}
        gameMode={gameMode}
        quizUiVariant={quizUiVariant}
        selectedQuizIndex={selectedQuizIndex}
        onReplaySnippet={onReplaySnippet}
        onReveal={onReveal}
        onConfirmQuiz={onConfirmQuiz}
        onNextRound={onNextRound}
      />
    </div>
  );
}

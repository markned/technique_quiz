import { IntroScreen } from "./components/IntroScreen";
import { OutroScreen } from "./components/OutroScreen";
import { GamePauseToggle } from "./components/GamePauseToggle";
import { QuizBackground } from "./components/QuizBackground";
import { QuizScreen } from "./components/QuizScreen";
import { ExitConfirmDialog } from "./components/ExitConfirmDialog";
import { RestartConfirmDialog } from "./components/RestartConfirmDialog";
import { RulesOverlay } from "./components/RulesOverlay";
import { RulesScreen } from "./components/RulesScreen";
import { StartScreen } from "./components/StartScreen";
import { TransitionOverlay } from "./components/TransitionOverlay";
import { getGuessSeconds } from "./helpers/quizConfig";
import { useQuizGame } from "./hooks/useQuizGame";

export default function App() {
  const game = useQuizGame();

  if (game.previewLoading) {
    return (
      <main className="app-shell app-shell-start">
        <p className="app-preview-loading">Загрузка предпросмотра…</p>
      </main>
    );
  }

  if (game.roundState === "intro") {
    if (game.isStartCinematic) {
      return <IntroScreen onVideoEnded={game.onIntroVideoEnded} onSkip={game.skipIntroAndGoToRules} />;
    }
    return (
      <main className="app-shell app-shell-start">
        <StartScreen onStart={game.startQuiz} />
      </main>
    );
  }

  if (game.roundState === "rules") {
    return <RulesScreen onComplete={game.skipRulesAndStart} />;
  }

  if (game.roundState === "finished") {
    return <OutroScreen onRestart={game.restartQuiz} onExitToStart={game.exitToStartScreen} />;
  }

  if (!game.round) {
    return null;
  }

  return (
    <main className="app-shell app-shell-quiz">
      {game.previewMode && (
        <div className="preview-mode-banner" role="status">
          Предпросмотр одного раунда — выход в меню ведёт в редактор.
          {game.roundState === "transition" ? (
            <span className="preview-mode-banner-hint"> Коснитесь экрана или нажмите клавишу, чтобы начать (нужно для звука в Safari).</span>
          ) : null}
        </div>
      )}
      <QuizBackground photoUrl={game.roundPhotoBackground} youtubeSrc={game.roundYoutubeBackgroundEmbed} />
      <GamePauseToggle
        paused={game.gamePaused}
        disabled={game.roundState === "transition"}
        onToggle={game.toggleGamePause}
        touchMode={game.gesturePauseLayout}
        onRestartRequest={() => game.setShowRestartConfirm(true)}
        onExitToStart={() => game.setShowExitConfirm(true)}
        onRulesRequest={() => game.setShowRulesOverlay(true)}
      />
      <div className="app-overlay" key={game.roundIndex}>
        <QuizScreen
          round={game.round}
          roundIndex={game.roundIndex}
          totalRounds={game.orderedRounds.length}
          roundState={game.roundState}
          hintLines={game.hintLines}
          revealLines={game.revealLines}
          visibleHintLineCount={game.visibleHintLineCount}
          timerSeconds={game.timerSeconds}
          totalSeconds={getGuessSeconds(game.revealLines.length)}
          onReplaySnippet={game.replaySnippet}
          onReveal={game.handleRevealClick}
          onNextRound={game.nextRound}
        />
      </div>
      <RestartConfirmDialog
        open={game.showRestartConfirm}
        onCancel={() => game.setShowRestartConfirm(false)}
        onConfirm={() => {
          game.setShowRestartConfirm(false);
          game.restartQuiz();
        }}
      />
      <ExitConfirmDialog
        open={game.showExitConfirm}
        onCancel={() => game.setShowExitConfirm(false)}
        onConfirm={() => {
          game.setShowExitConfirm(false);
          game.exitToStartScreen();
        }}
      />
      <RulesOverlay open={game.showRulesOverlay} onClose={() => game.setShowRulesOverlay(false)} />
      <TransitionOverlay visible={game.roundState === "transition"} nextRoundTitle={game.upcomingRoundTitle} />
    </main>
  );
}

import { useMenuStage, recentRoom } from "./navigation";
import { IntroScreen } from "./components/IntroScreen";
import { GameRulesScreen } from "./components/GameRulesScreen";
import { ModeSelectScreen } from "./components/ModeSelectScreen";
import { OutroScreen } from "./components/OutroScreen";
import { GamePauseToggle } from "./components/GamePauseToggle";
import { DockChromaKeyLayer } from "./components/DockChromaKeyLayer";
import { QuizBackground } from "./components/QuizBackground";
import { QuizScreen } from "./components/QuizScreen";
import { ExitConfirmDialog } from "./components/ExitConfirmDialog";
import { RestartConfirmDialog } from "./components/RestartConfirmDialog";
import { RulesOverlay } from "./components/RulesOverlay";
import { RulesScreen } from "./components/RulesScreen";
import { MainModeChoiceScreen } from "./components/MainModeChoiceScreen";
import { StartScreen } from "./components/StartScreen";
import { TransitionOverlay } from "./components/TransitionOverlay";
import { useEffect, useMemo, type ReactNode } from "react";
import { MasterVolumeControl } from "./components/MasterVolumeControl";
import { getGuessSeconds } from "./helpers/quizConfig";
import { useQuizGame } from "./hooks/useQuizGame";
import { MultiplayerHostApp, MultiplayerPlayerApp } from "./multiplayer/MultiplayerApps";
import { MultiplayerEntryScreen } from "./multiplayer/MultiplayerEntryScreen";
import { parseAppRoute } from "./multiplayer/routes";

function LocalGameApp({
  quizOnly = false,
  onExitToHome,
  initialRoundState,
}: {
  quizOnly?: boolean;
  onExitToHome?: () => void;
  initialRoundState?: "intro" | "game_rules";
}) {
  const game = useQuizGame({ initialRoundState });
  useEffect(() => {
    if (!quizOnly || game.previewMode) return;
    const pop = (e: PopStateEvent) => {
      const target = window.location.hash.slice(1);
      const active = !["game_rules", "rules", "intro", "finished"].includes(game.roundState);
      if (
        active &&
        target !== "singleplayer/play" &&
        !window.confirm("Выйти из игры? Текущий прогресс будет сброшен.")
      ) {
        e.stopImmediatePropagation();
        history.forward();
        return;
      }
      if (target === "singleplayer") game.backToGameRules();
      if (target === "singleplayer/controls") game.restartQuiz();
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [quizOnly, game]);
  const selectQuiz = () => {
    history.pushState(null, "", "#singleplayer/controls");
    game.selectGameMode("quiz");
  };
  const playQuiz = () => {
    if (quizOnly && !game.previewMode) history.pushState(null, "", "#singleplayer/play");
    game.skipRulesAndStart();
  };

  let content: ReactNode;

  if (game.previewLoading) {
    content = (
      <main className="app-shell app-shell-start">
        <p className="app-preview-loading">Загрузка предпросмотра…</p>
      </main>
    );
  } else if (game.roundState === "intro") {
    if (game.isStartCinematic) {
      content = <IntroScreen onVideoEnded={game.onIntroVideoEnded} onSkip={game.skipIntroAndGoToRules} />;
    } else {
      content = (
        <main className="app-shell app-shell-start">
          <StartScreen onStart={game.startQuiz} />
        </main>
      );
    }
  } else if (game.roundState === "game_rules") {
    content = (
      <GameRulesScreen
        onBack={onExitToHome}
        rulesScope={quizOnly ? "quiz" : "common"}
        onComplete={quizOnly ? selectQuiz : game.skipGameRulesToModeSelect}
      />
    );
  } else if (game.roundState === "mode_select") {
    content = (
      <ModeSelectScreen onSelectMode={game.selectGameMode} quizEligibleCount={game.quiz.eligibleCount} />
    );
  } else if (game.roundState === "rules") {
    if (!game.gameMode) {
      content = null;
    } else {
      content = <RulesScreen onBack={game.backToGameRules} onComplete={playQuiz} gameMode={game.gameMode} />;
    }
  } else if (game.roundState === "finished") {
    const subtitle = game.gameMode === "quiz" ? `Правильных ответов: ${game.quiz.score}` : undefined;
    content = (
      <OutroScreen
        videoSrc={game.outroVideoSrc}
        subtitle={subtitle}
        restartLabel={quizOnly ? "Сыграть ещё" : "К выбору режима"}
        onBackToModeSelect={
          quizOnly
            ? () => {
                history.replaceState(null, "", "#singleplayer/controls");
                game.restartQuiz();
              }
            : game.returnToModeSelect
        }
        onExitToStart={() => {
          game.exitToStartScreen();
          onExitToHome?.();
        }}
      />
    );
  } else if (!game.round) {
    content = null;
  } else {
    content = (
      <main className="app-shell app-shell-quiz">
        {game.previewMode && (
          <div className="preview-mode-banner" role="status">
            Предпросмотр одного раунда — выход в меню ведёт в редактор.
            {game.roundState === "transition" ? (
              <span className="preview-mode-banner-hint">
                {" "}
                Коснитесь экрана или нажмите клавишу, чтобы начать (нужно для звука в Safari).
              </span>
            ) : null}
          </div>
        )}
        <QuizBackground
          photoUrl={game.roundPhotoBackground}
          youtubeSrc={game.roundYoutubeBackgroundEmbed}
          videoSrc={game.roundVideoBackgroundUrl}
          videoStartSec={game.roundVideoBackgroundStart}
        />
        <DockChromaKeyLayer />
        <GamePauseToggle
          paused={game.gamePaused}
          disabled={game.roundState === "transition" || game.roundState === "quiz_feedback"}
          onToggle={game.toggleGamePause}
          touchMode={game.gesturePauseLayout}
          gameMode={game.gameMode}
          quizUiVariant={game.quiz.uiVariant}
          restartLabel={quizOnly ? "Начать заново" : "К режимам"}
          onReturnToModeSelectRequest={() => game.overlay.setShowRestartConfirm(true)}
          onExitToStart={() => game.overlay.setShowExitConfirm(true)}
          onRulesRequest={() => game.overlay.setShowRulesOverlay(true)}
        />
        <div className="app-overlay" key={game.roundIndex}>
          <QuizScreen
            round={game.round}
            roundIndex={game.roundIndex}
            totalRounds={game.orderedRounds.length}
            roundState={game.roundState}
            gameMode={game.gameMode}
            quizScore={game.quiz.score}
            quizOptions={game.quiz.options}
            quizUiVariant={game.quiz.uiVariant}
            quizOrderUserIds={game.quiz.orderUserIds}
            onReorderQuizOrder={game.quiz.reorderLines}
            quizCorrectIndex={game.quiz.correctIndex}
            selectedQuizIndex={game.quiz.selectedIndex}
            onSelectQuizOption={game.quiz.setSelection}
            hintLines={game.hintLines}
            revealLines={game.revealLines}
            visibleHintLineCount={game.visibleHintLineCount}
            timerSeconds={game.timerSeconds}
            totalSeconds={getGuessSeconds(game.revealLines.length)}
            gamePaused={game.gamePaused}
            onReplaySnippet={game.replaySnippet}
            onReveal={game.handleRevealClick}
            onConfirmQuiz={game.quiz.confirm}
            onNextRound={game.nextRound}
          />
        </div>
        <RestartConfirmDialog
          open={game.overlay.showRestartConfirm}
          onCancel={() => game.overlay.setShowRestartConfirm(false)}
          onConfirm={() => {
            game.overlay.setShowRestartConfirm(false);
            if (quizOnly) {
              history.replaceState(null, "", "#singleplayer/controls");
              game.restartQuiz();
            } else {
              game.returnToModeSelect();
            }
          }}
        />
        <ExitConfirmDialog
          open={game.overlay.showExitConfirm}
          onCancel={() => game.overlay.setShowExitConfirm(false)}
          onConfirm={() => {
            game.overlay.setShowExitConfirm(false);
            game.exitToStartScreen();
            onExitToHome?.();
          }}
        />
        <RulesOverlay
          open={game.overlay.showRulesOverlay}
          gameMode={game.gameMode}
          onClose={() => game.overlay.setShowRulesOverlay(false)}
        />
        <TransitionOverlay
          visible={game.roundState === "transition"}
          nextRoundTitle={game.upcomingRoundTitle}
        />
      </main>
    );
  }

  return (
    <>
      <MasterVolumeControl />
      {content}
    </>
  );
}

function HomeApp() {
  const [stage, setStage] = useMenuStage();
  if (stage === "intro") {
    return (
      <>
        <MasterVolumeControl />
        <IntroScreen
          onVideoEnded={() => setStage("main_mode_choice")}
          onSkip={() => setStage("main_mode_choice")}
        />
      </>
    );
  }
  if (stage === "main_mode_choice" || stage === "menu") {
    return (
      <>
        <MasterVolumeControl />
        <button className="menu-back" onClick={() => setStage("start")}>
          ← Назад
        </button>
        {recentRoom() ? (
          <a
            className="recent-room"
            href={`/room/${recentRoom()!.code}/${recentRoom()!.role === "host" ? "host" : "player"}`}
          >
            Вернуться в комнату {recentRoom()!.code} · {recentRoom()!.role === "host" ? "Ведущий" : "Игрок"}
          </a>
        ) : null}
        <MainModeChoiceScreen
          onSingleplayer={() => setStage("singleplayer")}
          onMultiplayer={() => setStage("multiplayer")}
        />
      </>
    );
  }
  if (stage.startsWith("singleplayer")) {
    return <LocalGameApp quizOnly initialRoundState="game_rules" onExitToHome={() => setStage("menu")} />;
  }
  if (stage === "multiplayer") {
    return (
      <>
        <MasterVolumeControl />
        <button className="menu-back" onClick={() => setStage("menu")}>
          ← Назад
        </button>
        <MultiplayerEntryScreen />
      </>
    );
  }
  return (
    <>
      <MasterVolumeControl />
      <main className="app-shell app-shell-start">
        <StartScreen onStart={() => setStage("intro")} />
      </main>
    </>
  );
}

function isPreviewRoute(): boolean {
  return new URLSearchParams(window.location.search).get("preview") === "1";
}

export default function App() {
  const route = useMemo(() => parseAppRoute(), []);
  if (isPreviewRoute()) return <LocalGameApp />;
  if (route.kind === "host") {
    return (
      <>
        <MasterVolumeControl />
        <MultiplayerHostApp code={route.code} />
      </>
    );
  }
  if (route.kind === "player") {
    return <MultiplayerPlayerApp code={route.code} />;
  }
  return <HomeApp />;
}

import { useCoarsePointer } from "../hooks/useCoarsePointer";
import { useGesturePauseLayout } from "../hooks/useGesturePauseLayout";
import { getControlsHintLines } from "../helpers/controlsCopy";
import type { GameMode } from "../types";
import { FREESTYLE_SIMILARITY_THRESHOLD } from "../multiplayer/similarity";

type RulesScreenProps = {
  onComplete: () => void;
  onBack?: () => void;
  gameMode: GameMode;
  multiplayer?: boolean;
};

/** Только управление — после выбора режима, перед первым раундом */
export function RulesScreen({ onComplete, onBack, gameMode, multiplayer = false }: RulesScreenProps) {
  const coarse = useCoarsePointer();
  const gesturePause = useGesturePauseLayout();
  const lines = multiplayer
    ? [
        {
          kbd: "1",
          anim: "pulse",
          text: "Откройте ссылку комнаты на телефонах или компьютерах игроков. Музыка звучит на общем экране.",
        },
        {
          kbd: "2",
          anim: "pulse",
          text:
            gameMode === "quiz"
              ? "Выбирайте один из четырёх вариантов ответа на своих устройствах. На общем экране ответы не нажимаются."
              : `Напишите продолжение и проголосуйте за чужой ответ. Победа в голосовании — +1; схожесть с оригиналом от ${FREESTYLE_SIMILARITY_THRESHOLD * 100}% — ещё +1. Пунктуация не влияет. При ничьей — жеребьёвка, без голосов — без бонуса за голосование.`,
        },
        {
          kbd: "3",
          anim: "pulse",
          text: "Сервер сам переключает этапы, считает очки и запускает следующий раунд. Нажимать «дальше» не нужно.",
        },
        {
          kbd: "4",
          anim: "pulse",
          text: "Для Discord транслируйте общий экран со звуком. При обрыве связи игрок может вернуться в ту же комнату.",
        },
      ]
    : getControlsHintLines(gameMode, { gesturePause, coarse });

  return (
    <main className="app-shell rules-screen-shell">
      <div className="rules-screen-card controls-screen-card">
        <p className="rules-step">{multiplayer ? "Игра вместе" : "Перед началом"} · Управление</p>
        <h2 id="rules-title" className="rules-screen-title">
          {multiplayer ? "Как играть вместе" : "Управление"}
        </h2>
        <div className="rules-screen-body controls-screen-body">
          <div className="rules-screen-text rules-screen-text--controls">
            <ul className="controls-hint-list controls-hint-list--in-rules">
              {lines.map((line, i) => (
                <li key={i} className={`controls-hint-item controls-hint-item--${line.anim}`}>
                  <span className="controls-hint-kbd" aria-hidden>
                    {line.kbd}
                  </span>
                  <span>{line.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="rules-screen-start-wrap">
          {onBack ? (
            <button className="btn rules-back" onClick={onBack}>
              ← Назад
            </button>
          ) : null}
          <button
            type="button"
            className="rules-screen-start-btn"
            onClick={onComplete}
            aria-label="Начать игру"
          >
            Начать игру →
          </button>
        </div>
      </div>
    </main>
  );
}

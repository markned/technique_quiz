import { useCoarsePointer } from "../hooks/useCoarsePointer";
import { useFitTextToHeight } from "../hooks/useFitTextToHeight";
import { useGesturePauseLayout } from "../hooks/useGesturePauseLayout";
import { getControlsHintLines } from "../helpers/controlsCopy";
import type { GameMode } from "../types";

type RulesScreenProps = {
  onComplete: () => void;
  gameMode: GameMode;
  multiplayer?: boolean;
};

/** Только управление — после выбора режима, перед первым раундом */
export function RulesScreen({ onComplete, gameMode, multiplayer = false }: RulesScreenProps) {
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
              ? "Выбирайте ответ или расставляйте строки на своих устройствах. На общем экране ответы не нажимаются."
              : "Напишите продолжение на своём устройстве, затем проголосуйте за чужой ответ.",
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
  const { containerRef, textRef } = useFitTextToHeight({ maxPx: 44, floorMinPx: 8 });

  return (
    <main className="app-shell rules-screen-shell">
      <div className="rules-screen-card controls-screen-card">
        <h2 id="rules-title" className="rules-screen-title">
          {multiplayer ? "Как играть вместе" : "Управление"}
        </h2>
        <div ref={containerRef} className="rules-screen-body controls-screen-body">
          <div ref={textRef} className="rules-screen-text rules-screen-text--controls">
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
          <button
            type="button"
            className="rules-screen-start-btn"
            onClick={onComplete}
            aria-label="Начать игру"
          >
            →
          </button>
        </div>
      </div>
    </main>
  );
}

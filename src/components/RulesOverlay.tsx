import { RulesCard } from "./RulesCard";
import { GameRulesCommon } from "../content/rules";
import type { GameMode } from "../types";

type RulesOverlayProps = {
  open: boolean;
  onClose: () => void;
  gameMode: GameMode | null;
};

/** Общие правила поверх квиза (пауза) */
export function RulesOverlay({ open, onClose, gameMode }: RulesOverlayProps) {
  if (!open) {
    return null;
  }
  const rulesScope = gameMode ?? "common";

  return (
    <div className="rules-overlay-root" role="dialog" aria-modal="true" aria-labelledby="rules-title">
      <div className="rules-overlay-scrim" onClick={onClose} role="presentation" />
      <div className="rules-overlay-stage">
        <RulesCard
          mode={rulesScope}
          rulesTitle="Об игре"
          playAudio={false}
          rulesContent={<GameRulesCommon scope={rulesScope} />}
          footer={
            <div className="rules-screen-start-wrap">
              <button type="button" className="rules-screen-start-btn" onClick={onClose} aria-label="Закрыть">
                ✕
              </button>
            </div>
          }
        />
      </div>
    </div>
  );
}

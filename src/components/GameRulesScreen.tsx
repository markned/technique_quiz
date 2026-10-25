import { RulesCard } from "./RulesCard";
import { GameRulesCommon } from "../content/rules";
import type { GameMode } from "../types";

type GameRulesScreenProps = {
  onComplete: () => void;
  onBack?: () => void;
  rulesScope?: GameMode | "common";
};

/** Общие правила — до выбора режима */
export function GameRulesScreen({ onComplete, onBack, rulesScope = "common" }: GameRulesScreenProps) {
  const actionLabel = rulesScope === "common" ? "К выбору режима" : "К управлению";
  return (
    <main className="app-shell rules-screen-shell">
      <RulesCard
        mode={rulesScope}
        rulesTitle="Об игре"
        playAudio={false}
        rulesContent={<GameRulesCommon scope={rulesScope} />}
        footer={
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
              aria-label={actionLabel}
            >
              {actionLabel} →
            </button>
          </div>
        }
      />
    </main>
  );
}

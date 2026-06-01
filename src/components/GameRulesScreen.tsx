import { RulesCard } from "./RulesCard";
import { GameRulesCommon } from "../content/rules";
import type { GameMode } from "../types";

type GameRulesScreenProps = {
  onComplete: () => void;
  rulesScope?: GameMode | "common";
};

/** Общие правила — до выбора режима */
export function GameRulesScreen({ onComplete, rulesScope = "common" }: GameRulesScreenProps) {
  return (
    <main className="app-shell rules-screen-shell">
      <RulesCard
        mode={rulesScope}
        rulesTitle="Об игре"
        playAudio={false}
        rulesContent={<GameRulesCommon scope={rulesScope} />}
        footer={
          <div className="rules-screen-start-wrap">
            <button
              type="button"
              className="rules-screen-start-btn"
              onClick={onComplete}
              aria-label="К выбору режима"
            >
              →
            </button>
          </div>
        }
      />
    </main>
  );
}

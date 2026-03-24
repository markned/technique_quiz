import { useState } from "react";
import { GAME_RULES } from "../content/rules";
import { assetUrl } from "../helpers/quizConfig";

type StartScreenProps = {
  onStart: () => void;
};

export function StartScreen({ onStart }: StartScreenProps) {
  const [showRules, setShowRules] = useState(false);

  return (
    <>
      <div className="start-screen start-screen-icon" onClick={onStart}>
        <img
          src={assetUrl("/content/photos/start-icon.png")}
          alt="Начать"
          className="start-icon"
        />
        <button
          className="rules-btn"
          onClick={(e) => {
            e.stopPropagation();
            setShowRules(true);
          }}
        >
          Правила
        </button>
      </div>
      {showRules && (
        <div
          className="rules-backdrop"
          onClick={() => setShowRules(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="rules-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Правила игры</h3>
            <pre className="rules-text">{GAME_RULES}</pre>
            <button className="btn btn-primary" onClick={() => setShowRules(false)}>
              Понятно
            </button>
          </div>
        </div>
      )}
    </>
  );
}

import { useEffect, useRef } from "react";
import { RulesCard } from "./RulesCard";
import { GameRulesCommon } from "../content/rules";
import type { GameMode } from "../types";

type RulesOverlayProps = {
  open: boolean;
  multiplayer?: boolean;
  onClose: () => void;
  gameMode: GameMode | null;
};

/** Общие правила поверх квиза (пауза) */
export function RulesOverlay({ open, onClose, gameMode, multiplayer = false }: RulesOverlayProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement;
    root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
      if (e.key === "Tab") {
        const buttons = root.current?.querySelectorAll<HTMLButtonElement>("button, a[href]");
        if (!buttons?.length) return;
        const first = buttons[0]!,
          last = buttons[buttons.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      previous?.focus();
    };
  }, [open, onClose]);
  if (!open) {
    return null;
  }
  const rulesScope = gameMode ?? "common";

  return (
    <div
      ref={root}
      className="rules-overlay-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-title"
    >
      <div className="rules-overlay-scrim" onClick={onClose} role="presentation" />
      <div className="rules-overlay-stage">
        <RulesCard
          mode={rulesScope}
          rulesTitle="Об игре"
          playAudio={false}
          rulesContent={
            multiplayer ? (
              <>
                <p>Музыка звучит на общем экране. Отвечай на своём устройстве.</p>
                <p>
                  {gameMode === "quiz"
                    ? "Выбери один из четырёх вариантов и подтверди ответ."
                    : "Напиши продолжение, затем выбери лучший чужой ответ."}
                </p>
                <p>
                  Пока ты не ответил, можно повторить фрагмент. Повтор общий для всех, таймер ответа на это
                  время остановлен.
                </p>
                <p>Паузой управляет ведущий. Меню игрока не останавливает игру.</p>
              </>
            ) : (
              <GameRulesCommon scope={rulesScope} />
            )
          }
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

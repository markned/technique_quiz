import { useEffect, useRef, useState } from "react";
import type { PublicRoomState } from "./types";
import type { ClientMessage } from "./messages";
import { navigateMenu } from "../navigation";
import { RulesOverlay } from "../components/RulesOverlay";

export function RoomMenu({
  state,
  role,
  send,
  onExit,
}: {
  state: PublicRoomState | null;
  role: "host" | "player";
  send: (message: ClientMessage) => boolean;
  onExit?: () => void;
}) {
  const leaving = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState(false);
  const active = !!state && !["lobby", "mode_select", "rules", "finished", "expired"].includes(state.phase);
  const show = () => {
    setOpen(true);
    if (role === "host" && active && !state?.pausedAt) send({ type: "host_pause", paused: true });
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || /INPUT|TEXTAREA/.test((e.target as HTMLElement)?.tagName)) return;
      e.preventDefault();
      if (rules) setRules(false);
      else if (open) setOpen(false);
      else show();
    };
    const before = (e: BeforeUnloadEvent) => {
      if (active && !leaving.current) e.preventDefault();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("beforeunload", before);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("beforeunload", before);
    };
  });
  useEffect(() => {
    if (!open || rules) return;
    const previous = document.activeElement as HTMLElement;
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled), a[href]");
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
    };
    window.addEventListener("keydown", trap);
    return () => {
      window.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [open, rules]);
  const exit = () => {
    if (
      state &&
      !window.confirm(
        role === "host"
          ? "Выйти в меню? Участники будут ждать возвращения ведущего."
          : "Выйти из комнаты? Остальные участники продолжат игру.",
      )
    )
      return;
    leaving.current = true;
    if (onExit) {
      onExit();
      return;
    }
    if (role === "player" && state) {
      send({ type: "player_leave" });
      return;
    }
    navigateMenu();
  };
  return (
    <>
      <button className="menu-back room-menu-toggle" onClick={show}>
        {role === "host" && active ? "⏸ Пауза / меню" : "☰ Меню"}
      </button>
      {state?.pausedAt && role === "player" ? (
        <p className="player-pause-notice" role="status">
          {state.manualPaused ? "Ведущий поставил игру на паузу" : "Пауза — ждём главный экран"}
        </p>
      ) : null}
      {state?.manualPaused && role === "host" && !open ? (
        <button className="manual-resume btn" onClick={() => send({ type: "host_pause", paused: false })}>
          ▶ Продолжить игру
        </button>
      ) : null}
      {open ? (
        <div ref={dialog} className="navigation-modal" role="dialog" aria-modal="true" aria-label="Меню игры">
          <section className="navigation-card">
            <p className="multiplayer-eyebrow">
              {role === "host" ? "Главный экран" : "Игрок"} {state ? `· ${state.code}` : ""}
            </p>
            <h2>{state?.manualPaused ? "Игра на паузе" : "Меню игры"}</h2>
            {role === "player" && active ? (
              <p>Это меню не останавливает игру у остальных участников.</p>
            ) : null}
            <button
              autoFocus
              className="btn btn-primary"
              onClick={() => {
                if (role === "host" && state?.manualPaused) send({ type: "host_pause", paused: false });
                setOpen(false);
              }}
            >
              {active ? "Продолжить игру" : "Вернуться"}
            </button>
            {state?.mode ? (
              <button className="btn" onClick={() => setRules(true)}>
                Правила и управление
              </button>
            ) : null}
            {role === "host" && state && ["rules", "mode_select"].includes(state.phase) ? (
              <button
                className="btn"
                onClick={() => {
                  send({ type: "host_return_lobby" });
                  setOpen(false);
                }}
              >
                Назад в лобби
              </button>
            ) : null}
            <button className="btn" onClick={exit}>
              {role === "host" ? "В меню" : state ? "Выйти из комнаты" : "Назад в меню"}
            </button>
          </section>
        </div>
      ) : null}
      <RulesOverlay
        open={rules}
        onClose={() => setRules(false)}
        gameMode={state?.mode ?? null}
        multiplayer
        online={!!state?.online}
      />
    </>
  );
}

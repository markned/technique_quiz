import { useEffect, useRef, useState } from "react";
import { generateRoomCode } from "../multiplayer/identity";
import "./simulation.css";

function SessionWindow({
  title,
  src,
  phone = false,
  primary = false,
  automatic,
}: {
  title: string;
  src: string;
  phone?: boolean;
  primary?: boolean;
  automatic: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0.5);
  const width = phone ? 390 : primary ? 1280 : 800;
  const height = phone ? 780 : primary ? 800 : 650;
  const sync = () =>
    frame.current?.contentWindow?.postMessage(
      { type: "simulation-auto", enabled: automatic },
      window.location.origin,
    );
  useEffect(() => {
    sync();
    const ready = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.source === frame.current?.contentWindow &&
        event.data?.type === "simulation-ready"
      )
        sync();
    };
    window.addEventListener("message", ready);
    return () => window.removeEventListener("message", ready);
  }, [automatic]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setScale(Math.min(entry.contentRect.width / width, entry.contentRect.height / height)),
    );
    if (box.current) observer.observe(box.current);
    return () => observer.disconnect();
  }, [width, height]);
  return (
    <section className="sim-window">
      <header>{title}</header>
      <div className="sim-viewport" ref={box}>
        <iframe
          ref={frame}
          title={title}
          src={src}
          allow="autoplay; fullscreen"
          onLoad={sync}
          style={{ width, height, transform: `translate(-50%, -50%) scale(${scale})` }}
        />
      </div>
    </section>
  );
}

export function MultiplayerSimulation() {
  const fast = new URLSearchParams(window.location.search).get("fast") === "1";
  const createCode = () => (fast ? `E2EF${generateRoomCode().slice(0, 2)}` : generateRoomCode());
  const [code, setCode] = useState(createCode);
  const [playerCount, setPlayerCount] = useState(3);
  const [readyCode, setReadyCode] = useState("");
  useEffect(() => {
    const ready = (event: MessageEvent) => {
      const host = document.querySelector<HTMLIFrameElement>(
        'iframe[title="Основной сеанс · звук и ход игры"]',
      );
      if (
        event.origin === window.location.origin &&
        event.source === host?.contentWindow &&
        event.data?.type === "simulation-host-ready" &&
        event.data.code === code
      )
        setReadyCode(code);
    };
    window.addEventListener("message", ready);
    return () => window.removeEventListener("message", ready);
  }, [code]);
  const server =
    fast && import.meta.env.DEV ? "&simServer=" + encodeURIComponent("http://localhost:2001") : "";
  const [automatic, setAutomatic] = useState(false);
  const [layout, setLayout] = useState("grid");
  return (
    <main className="sim-shell">
      <header className="sim-toolbar">
        <div>
          <strong>Мультиплеер · {code}</strong>
          <span>
            {fast
              ? playerCount >= 3
                ? "Ускоренный полный сеанс: викторина → голосование → фристайл"
                : "Викторина для двоих · фристайл доступен от 3 игроков"
              : "Общий экран со звуком + независимые игроки"}
          </span>
        </div>
        <button onClick={() => setAutomatic(!automatic)}>
          {automatic ? "Ручное управление" : "Запустить симуляцию"}
        </button>
        <button onClick={() => setLayout(layout === "phones" ? "grid" : "phones")}>
          {layout === "phones" ? "Раскладка 2 × 2" : "Общий + телефоны"}
        </button>
        <button
          onClick={() => {
            setAutomatic(false);
            setPlayerCount(playerCount === 2 ? 3 : 2);
            setCode(createCode());
          }}
        >
          {playerCount} игрока
        </button>
        <button
          onClick={() => {
            setAutomatic(false);
            setCode(createCode());
          }}
        >
          Новая комната
        </button>
      </header>
      <div className={`sim-layout sim-layout-${layout} sim-players-${playerCount}`} key={code}>
        <SessionWindow
          primary
          title="Основной сеанс · звук и ход игры"
          src={`/room/${code}/host?simClient=${code}-host&simPlayers=${playerCount}${server}`}
          automatic={automatic}
        />
        <div className="sim-clients">
          {(readyCode === code ? ["Аня", "Борис", "Вика"].slice(0, playerCount) : []).map((name, index) => (
            <SessionWindow
              key={name}
              title={`Игрок ${index + 1} · ${name}`}
              src={`/room/${code}?simClient=${code}-${index}&simName=${encodeURIComponent(name)}&simIndex=${index}${server}`}
              phone={layout === "phones"}
              automatic={automatic}
            />
          ))}
        </div>
      </div>
      <footer className="sim-footer">
        {automatic
          ? "Игроки отвечают автоматически. Можно нажимать кнопки в любом окне."
          : "Все окна интерактивны. Запустите симуляцию или управляйте игрой вручную."}{" "}
        Это настоящая локальная игра с отдельными подключениями.
      </footer>
    </main>
  );
}

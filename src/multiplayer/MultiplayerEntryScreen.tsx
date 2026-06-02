import { FormEvent, useMemo, useState } from "react";
import { generateRoomCode, normalizeRoomCode } from "./identity";
import { hostPath, playerPath } from "./routes";

export function MultiplayerEntryScreen() {
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const normalizedCode = useMemo(() => normalizeRoomCode(roomCode), [roomCode]);

  const createRoom = () => {
    window.location.href = hostPath(generateRoomCode());
  };

  const joinRoom = (event: FormEvent) => {
    event.preventDefault();
    if (normalizedCode.length !== 6) {
      setError("Код комнаты состоит из 6 символов.");
      return;
    }
    window.location.href = playerPath(normalizedCode);
  };

  return (
    <main className="app-shell multiplayer-shell multiplayer-entry-shell">
      <section className="multiplayer-panel multiplayer-menu-card">
        <p className="multiplayer-eyebrow">Мультиплеер</p>
        <h1>Комната игры</h1>
        <p className="multiplayer-muted">
          Создай комнату на главном экране или введи код, если подключаешься с телефона.
        </p>
        <div className="multiplayer-entry-actions">
          <button type="button" className="btn btn-primary btn-hero" onClick={createRoom}>
            Создать комнату
          </button>
          <form className="multiplayer-join-form" onSubmit={joinRoom}>
            <label className="multiplayer-field multiplayer-code-field">
              Код комнаты
              <input
                value={roomCode}
                onChange={(event) => {
                  setError(null);
                  setRoomCode(normalizeRoomCode(event.target.value));
                }}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder="ABC123"
              />
            </label>
            {error ? (
              <p className="multiplayer-status multiplayer-status--error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn btn-hero" disabled={normalizedCode.length !== 6}>
              Войти по коду
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

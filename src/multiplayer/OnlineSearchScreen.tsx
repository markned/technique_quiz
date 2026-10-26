import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "../community/api";
import { AdmissionPanel } from "./admission";
import { useAdmission } from "./useAdmission";
import {
  getOrCreateClientId,
  getOrCreatePlayerToken,
  getSavedPlayerName,
  rememberOnlineAssignment,
  rememberPlayerName,
} from "./identity";

export function OnlineSearchScreen() {
  const [name, setName] = useState(getSavedPlayerName);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const clientId = useMemo(() => getOrCreateClientId(), []);
  const playerToken = useMemo(() => getOrCreatePlayerToken("ONLINE"), []);
  const admission = useAdmission("ONLINE", "player", clientId, searching, "queue");
  const { ticket, invalidate } = admission;
  useEffect(() => {
    if (!searching || !ticket) return;
    const abort = new AbortController();
    void fetch(apiUrl("/api/online/search"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ticket}` },
      body: JSON.stringify({
        clientId,
        playerToken,
        fresh: new URLSearchParams(window.location.search).get("fresh") === "1",
      }),
      signal: abort.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as { code: string; ticket: string; error?: string };
        if (!response.ok) {
          if (response.status === 403) invalidate();
          throw new Error(data.error ?? "Поиск недоступен.");
        }
        if (abort.signal.aborted) return;
        rememberOnlineAssignment(data.code, playerToken, data.ticket);
        window.location.href = `/online/${data.code}`;
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setError(e instanceof Error ? e.message : "Повтори поиск.");
          setSearching(false);
        }
      });
    return () => abort.abort();
  }, [searching, ticket, clientId, playerToken, invalidate]);
  if (searching && !admission.ticket) return <AdmissionPanel admission={admission} />;
  return (
    <main className="app-shell rules-screen-shell multiplayer-shell multiplayer-entry-shell">
      <section className="rules-screen-card multiplayer-panel multiplayer-menu-card">
        <p className="multiplayer-eyebrow">Мультиплеер</p>
        <h1 className="rules-screen-title">Онлайн-матч</h1>
        <p>
          Случайные соперники, музыка на каждом устройстве. До 6 игроков, режим выбираете вместе. Матч — 5
          раундов.
        </p>
        <form
          className="multiplayer-join-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            rememberPlayerName(name.trim());
            setError("");
            setSearching(true);
          }}
        >
          <label className="multiplayer-field">
            Имя
            <input
              maxLength={24}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="nickname"
              disabled={searching}
            />
          </label>
          <button className="btn btn-primary" disabled={!name.trim() || searching}>
            {searching ? "Ищем игроков…" : "Найти игру"}
          </button>
        </form>
        {error ? <p role="alert">{error}</p> : null}
        <a href="/#multiplayer" className="btn">
          ← Назад
        </a>
      </section>
    </main>
  );
}

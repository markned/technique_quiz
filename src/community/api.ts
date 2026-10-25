import { partySocketOptionsFromEnv } from "../multiplayer/env";
import { rounds } from "../content/rounds";
import type { Round } from "../types";

export function apiUrl(path: string) {
  const { host, protocol } = partySocketOptionsFromEnv();
  return `${protocol === "wss" ? "https" : "http"}://${host}${path}`;
}
export async function loadCommunityCatalog() {
  try {
    const response = await fetch(apiUrl("/api/catalog"), { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return;
    const data = (await response.json()) as { rounds: Round[] };
    const existing = new Set(rounds.map((round) => round.id));
    rounds.push(...data.rounds.filter((round) => !existing.has(round.id)));
  } catch {
    /* The official catalog remains playable if community storage is unavailable. */
  }
}

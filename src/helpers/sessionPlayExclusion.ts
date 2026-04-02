import type { Round } from "../types";

const STORAGE_KEY = "technique_quiz_recent_session_round_ids";

type Stored = { sessions: number[][] };

function readStored(): Stored {
  if (typeof sessionStorage === "undefined") return { sessions: [] };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { sessions: [] };
    const data = JSON.parse(raw) as Stored;
    if (!Array.isArray(data.sessions)) return { sessions: [] };
    return { sessions: data.sessions.filter((s) => Array.isArray(s)) };
  } catch {
    return { sessions: [] };
  }
}

/** Id раундов из последних двух завершённых игр — не использовать в следующей сборке порядка (если хватает пула). */
export function loadExcludedRoundIdsForNextSession(): Set<number> {
  const { sessions } = readStored();
  const ids = new Set<number>();
  for (const s of sessions.slice(-2)) {
    for (const id of s) {
      ids.add(id);
    }
  }
  return ids;
}

/** Сохранить состав завершённой сессии (полный проход). Храним последние 2 игры. */
export function recordCompletedSessionRoundIds(roundIds: number[]): void {
  if (typeof sessionStorage === "undefined") return;
  if (roundIds.length === 0) return;
  try {
    const data = readStored();
    data.sessions.push([...roundIds]);
    while (data.sessions.length > 2) {
      data.sessions.shift();
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* квота / приватный режим */
  }
}

/**
 * Убирает недавно игравшиеся раунды, если остаётся достаточно для сессии.
 * Иначе возвращает исходный список (без гарантии неповторов).
 */
export function applyRoundExclusion(visible: Round[], excludeIds: Set<number>, minRoundsNeeded: number): Round[] {
  const filtered = visible.filter((r) => !excludeIds.has(r.id));
  if (filtered.length >= minRoundsNeeded) return filtered;
  return visible;
}

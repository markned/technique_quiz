import type { GameMode, Round } from "../types";
import { idbDeletePreviewRound, idbGetPreviewRound, idbPutPreviewRound } from "./previewRoundIdb";

export const PREVIEW_ROUND_SESSION_KEY = "technique_quiz_preview_round";
export const EDITOR_SNAPSHOT_SESSION_KEY = "technique_quiz_editor_snapshot";

/** Маркер в sessionStorage: полный JSON раунда лежит в IndexedDB (Safari и др. часто не принимают большие строки). */
export const PREVIEW_IN_IDB_SENTINEL = "__technique_quiz_preview_idb__";

function clearEditorSnapshotEverywhere(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(EDITOR_SNAPSHOT_SESSION_KEY);
  localStorage.removeItem(EDITOR_SNAPSHOT_SESSION_KEY);
}

/** Снимок всех раундов перед уходом в предпросмотр — чтобы после возврата на `/editor` не потерять несохранённые правки. */
export function stashEditorSnapshotBeforePreview(snapshot: { rounds: Round[]; selectedIndex: number }): void {
  const payload = JSON.stringify(snapshot);
  try {
    sessionStorage.setItem(EDITOR_SNAPSHOT_SESSION_KEY, payload);
    localStorage.removeItem(EDITOR_SNAPSHOT_SESSION_KEY);
  } catch {
    try {
      localStorage.setItem(EDITOR_SNAPSHOT_SESSION_KEY, payload);
    } catch {
      // без снимка предпросмотр раунда всё равно возможен
    }
  }
}

let cachedEditorSnapshotForBootstrap: { rounds: Round[]; selectedIndex: number } | null | undefined;

function clampSelectedIndex(i: number, len: number): number {
  if (len <= 0) return 0;
  return Math.min(Math.max(0, i), len - 1);
}

/**
 * Один раз за загрузку страницы читает снимок из sessionStorage (и кэширует в модуле для Strict Mode).
 */
export function consumeEditorSnapshotForInitialState(): { rounds: Round[]; selectedIndex: number } | null {
  if (cachedEditorSnapshotForBootstrap !== undefined) {
    return cachedEditorSnapshotForBootstrap;
  }
  if (typeof window === "undefined") {
    cachedEditorSnapshotForBootstrap = null;
    return null;
  }
  const raw =
    sessionStorage.getItem(EDITOR_SNAPSHOT_SESSION_KEY) ?? localStorage.getItem(EDITOR_SNAPSHOT_SESSION_KEY);
  if (!raw) {
    cachedEditorSnapshotForBootstrap = null;
    return null;
  }
  try {
    const data = JSON.parse(raw) as { rounds?: Round[]; selectedIndex?: number };
    clearEditorSnapshotEverywhere();
    if (!data?.rounds || !Array.isArray(data.rounds)) {
      cachedEditorSnapshotForBootstrap = null;
      return null;
    }
    const rounds = data.rounds as Round[];
    const selectedIndex = clampSelectedIndex(data.selectedIndex ?? 0, rounds.length);
    cachedEditorSnapshotForBootstrap = { rounds, selectedIndex };
    return cachedEditorSnapshotForBootstrap;
  } catch {
    clearEditorSnapshotEverywhere();
    cachedEditorSnapshotForBootstrap = null;
    return null;
  }
}

/** Активен ли режим предпросмотра по `?preview=1`. */
export function isPreviewQueryActive(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("preview") === "1";
}

/** Синхронно: только если раунд целиком лежит в sessionStorage как JSON (без IDB). */
export function parsePreviewRoundFromSession(): Round | null {
  if (typeof window === "undefined") return null;
  if (!isPreviewQueryActive()) return null;
  const raw = sessionStorage.getItem(PREVIEW_ROUND_SESSION_KEY);
  if (!raw || raw === PREVIEW_IN_IDB_SENTINEL) return null;
  try {
    return JSON.parse(raw) as Round;
  } catch {
    return null;
  }
}

/** Асинхронная загрузка: sessionStorage (JSON или маркер) + fallback IndexedDB (нужно для Safari). */
export async function loadPreviewRoundFromStorageAsync(): Promise<Round | null> {
  if (typeof window === "undefined") return null;
  if (!isPreviewQueryActive()) return null;
  const raw = sessionStorage.getItem(PREVIEW_ROUND_SESSION_KEY);
  if (raw === PREVIEW_IN_IDB_SENTINEL) {
    return (await idbGetPreviewRound()) ?? null;
  }
  if (raw) {
    try {
      return JSON.parse(raw) as Round;
    } catch {
      return null;
    }
  }
  return (await idbGetPreviewRound()) ?? null;
}

export function stripPreviewQueryFromUrl(): void {
  const path = window.location.pathname + window.location.hash;
  window.history.replaceState({}, "", path);
}

export function clearPreviewRoundStorage(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PREVIEW_ROUND_SESSION_KEY);
  void idbDeletePreviewRound();
}

/**
 * Сохраняет раунд для «Тест раунда». Сначала sessionStorage; при ошибке — IndexedDB + короткий маркер.
 * Safari часто бросает QuotaExceededError на больших JSON в sessionStorage даже при «свободной» квоте.
 */
export async function stashRoundForPreview(round: Round): Promise<boolean> {
  const payload = JSON.stringify(round);
  /** Сразу в IDB: Safari иногда падает на setItem даже для «умеренных» строк (~500k+). */
  if (payload.length > 500_000) {
    try {
      await idbPutPreviewRound(round);
      sessionStorage.setItem(PREVIEW_ROUND_SESSION_KEY, PREVIEW_IN_IDB_SENTINEL);
      return true;
    } catch {
      return false;
    }
  }
  const tryPutSession = (): boolean => {
    try {
      sessionStorage.setItem(PREVIEW_ROUND_SESSION_KEY, payload);
      return true;
    } catch {
      return false;
    }
  };
  if (tryPutSession()) return true;
  try {
    sessionStorage.removeItem(EDITOR_SNAPSHOT_SESSION_KEY);
  } catch {
    /* ignore */
  }
  if (tryPutSession()) return true;
  try {
    await idbPutPreviewRound(round);
    sessionStorage.setItem(PREVIEW_ROUND_SESSION_KEY, PREVIEW_IN_IDB_SENTINEL);
    return true;
  } catch {
    return false;
  }
}

export function navigateToQuizPreview(mode: GameMode): void {
  const u = new URL(import.meta.env.BASE_URL, window.location.origin);
  u.searchParams.set("preview", "1");
  u.searchParams.set("previewMode", mode);
  window.location.href = u.pathname + u.search + u.hash;
}

/** Путь к редактору относительно `base` (например `/editor`). */
export function editorHref(): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  return `${base}editor`;
}

/** Корень приложения — полноэкранная викторина (без `/editor`). */
export function gameHref(): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  return base || "/";
}

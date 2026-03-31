import type { GameMode } from "../types";

/** Режим предпросмотра из редактора: `?preview=1&previewMode=quiz|freestyle` (читается при первом рендере). */
export function readPreviewEditorGameModeFromSearch(): GameMode {
  if (typeof window === "undefined") return "freestyle";
  const sp = new URLSearchParams(window.location.search);
  if (sp.get("preview") !== "1") return "freestyle";
  return sp.get("previewMode") === "quiz" ? "quiz" : "freestyle";
}

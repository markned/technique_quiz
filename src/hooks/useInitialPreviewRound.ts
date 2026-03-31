import { useEffect, useState } from "react";
import type { Round } from "../types";
import {
  clearPreviewRoundStorage,
  isPreviewQueryActive,
  loadPreviewRoundFromStorageAsync,
  parsePreviewRoundFromSession,
  stripPreviewQueryFromUrl,
} from "../editor/previewRoundStorage";

function tryParseInlinePreviewRound(): Round | null {
  return parsePreviewRoundFromSession();
}

export function useInitialPreviewRound(): { previewRound: Round | null; previewLoading: boolean } {
  const [previewRound, setPreviewRound] = useState<Round | null>(() => tryParseInlinePreviewRound());
  const [previewLoading, setPreviewLoading] = useState(
    () => isPreviewQueryActive() && tryParseInlinePreviewRound() === null,
  );

  useEffect(() => {
    if (!previewLoading) return;
    let cancelled = false;
    void loadPreviewRoundFromStorageAsync().then((r) => {
      if (cancelled) return;
      clearPreviewRoundStorage();
      stripPreviewQueryFromUrl();
      setPreviewRound(r);
      setPreviewLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [previewLoading]);

  useEffect(() => {
    if (previewLoading) return;
    if (!previewRound) return;
    if (!isPreviewQueryActive()) return;
    clearPreviewRoundStorage();
    stripPreviewQueryFromUrl();
  }, [previewLoading, previewRound]);

  return { previewRound, previewLoading };
}

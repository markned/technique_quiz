import type { Round } from "../types";
import { LOCAL_FILE_BY_TITLE, assetUrl } from "./quizConfig";

export const shuffle = <T,>(items: T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/** Переупорядочивает раунды так, чтобы один трек (title) не шёл два раза подряд. */
export const reorderNoConsecutiveSameTitle = <T extends { title: string }>(rounds: T[]): T[] => {
  if (rounds.length <= 1) return [...rounds];
  const result: T[] = [];
  const remaining = [...rounds];
  while (remaining.length > 0) {
    const lastTitle = result[result.length - 1]?.title ?? null;
    const idx = remaining.findIndex((r) => r.title !== lastTitle);
    const pickIdx = idx >= 0 ? idx : 0;
    result.push(remaining[pickIdx]);
    remaining.splice(pickIdx, 1);
  }
  return result;
};

export const toLocalMediaUrl = (round: Round): string => {
  const canonical = LOCAL_FILE_BY_TITLE[round.title];
  if (canonical) {
    return assetUrl(`/content/audio/${encodeURIComponent(canonical)}`);
  }
  if (round.url.startsWith("/")) {
    return round.url;
  }
  const slug = round.title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return assetUrl(`/content/audio/${slug || round.id}.mp3`);
};

export const getYouTubeEmbedUrl = (
  inputUrl: string,
  startSec: number,
  options: { muted: boolean; controls: boolean; loop: boolean },
): string | null => {
  try {
    const url = new URL(inputUrl);
    let videoId = "";
    if (url.hostname.includes("youtu.be")) {
      videoId = url.pathname.replace("/", "");
    } else if (url.hostname.includes("youtube.com")) {
      videoId = url.searchParams.get("v") || "";
    }
    if (!videoId) {
      return null;
    }
    const mute = options.muted ? 1 : 0;
    const controls = options.controls ? 1 : 0;
    const loop = options.loop ? 1 : 0;
    const playlist = options.loop ? `&playlist=${videoId}` : "";
    return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=${mute}&controls=${controls}&modestbranding=1&rel=0&playsinline=1&loop=${loop}${playlist}&start=${Math.max(0, Math.floor(startSec))}`;
  } catch {
    return null;
  }
};

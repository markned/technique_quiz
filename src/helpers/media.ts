import type { Round } from "../types";
import { apiUrl } from "../community/api";
import { audioMusicUrl } from "./audioPaths";

export const toLocalMediaUrl = (round: Round): string => {
  if (/^\/api\/media\/[a-f0-9-]{36}$/.test(round.audioFile)) return apiUrl(round.audioFile);
  if (round.audioFile.startsWith("data:audio/")) return round.audioFile;
  if (round.audioFile?.trim()) {
    return audioMusicUrl(round.audioFile.trim());
  }
  const slug = round.title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return audioMusicUrl(`${slug || String(round.id)}.m4a`);
};

/** Извлекает id ролика из watch / embed / shorts / youtu.be / music.youtube.com */
export function extractYouTubeVideoId(inputUrl: string): string | null {
  try {
    const url = new URL(inputUrl);
    const host = url.hostname.toLowerCase();
    const isShortHost = host === "youtu.be";
    const isYt = isShortHost || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com");

    if (!isYt) {
      return null;
    }

    const looksLikeId = (s: string) => /^[a-zA-Z0-9_-]{6,}$/.test(s);

    if (isShortHost) {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && looksLikeId(id) ? id : null;
    }

    const fromQuery = url.searchParams.get("v");
    if (fromQuery && looksLikeId(fromQuery)) {
      return fromQuery;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const embedIdx = parts.indexOf("embed");
    if (embedIdx >= 0 && parts[embedIdx + 1] && looksLikeId(parts[embedIdx + 1])) {
      return parts[embedIdx + 1];
    }
    const shortsIdx = parts.indexOf("shorts");
    if (shortsIdx >= 0 && parts[shortsIdx + 1] && looksLikeId(parts[shortsIdx + 1])) {
      return parts[shortsIdx + 1];
    }
    const liveIdx = parts.indexOf("live");
    if (liveIdx >= 0 && parts[liveIdx + 1] && looksLikeId(parts[liveIdx + 1])) {
      return parts[liveIdx + 1];
    }

    return null;
  } catch {
    return null;
  }
}

export const getYouTubeEmbedUrl = (
  inputUrl: string,
  startSec: number,
  options: { muted: boolean; controls: boolean; loop: boolean },
): string | null => {
  const videoId = extractYouTubeVideoId(inputUrl);
  if (!videoId) {
    return null;
  }
  const mute = options.muted ? 1 : 0;
  const controls = options.controls ? 1 : 0;
  const loop = options.loop ? 1 : 0;
  const playlist = options.loop ? `&playlist=${videoId}` : "";
  const start = Math.max(0, Math.floor(startSec));
  // nocookie + минимум параметров: автозапуск стабильнее без enablejsapi/origin;
  // полупрозрачность слоя с iframe отключена в QuizBackground (отдельный scrim)
  return `https://www.youtube-nocookie.com/embed/${videoId}?mute=${mute}&autoplay=1&controls=${controls}&modestbranding=1&rel=0&playsinline=1&loop=${loop}${playlist}&start=${start}`;
};

import { BACKGROUND_PHOTO_FILENAMES } from "virtual:background-photos";
import type { Round } from "../types";
import { getYouTubeEmbedUrl } from "./media";
import { buildBackgroundPhotoSequence } from "./backgroundPhotos";
import { assetUrl, assetUrlVideoRelative } from "./quizConfig";

export type RoundBackgroundSources = {
  photoUrl: string | null;
  youtubeSrc: string | null;
  videoSrc: string | null;
  videoStartSec: number;
};

export function buildRoundPhotoFilenameSequence(length: number): (string | null)[] {
  return buildBackgroundPhotoSequence(length, BACKGROUND_PHOTO_FILENAMES);
}

export function resolveRoundBackgroundSources(
  round: Round | null | undefined,
  photoFilename: string | null | undefined,
): RoundBackgroundSources {
  const videoSrc = round?.backgroundVideo ? assetUrlVideoRelative(round.backgroundVideo.file) : null;
  const youtubeSrc =
    round?.backgroundVideo || !round?.backgroundYoutube
      ? null
      : getYouTubeEmbedUrl(round.backgroundYoutube.url, round.backgroundYoutube.start, {
          muted: true,
          controls: false,
          loop: true,
        });

  return {
    photoUrl: round && photoFilename ? assetUrl(`/content/photos/${photoFilename}`) : null,
    youtubeSrc,
    videoSrc,
    videoStartSec: round?.backgroundVideo?.start ?? 0,
  };
}

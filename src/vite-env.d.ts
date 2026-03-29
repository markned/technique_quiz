/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GA_MEASUREMENT_ID?: string;
  readonly VITE_YM_COUNTER_ID?: string;
}

declare module "virtual:background-photos" {
  /** Имена `*.jpg` в `public/content/photos/` (на этапе сборки и при обновлении в dev). */
  export const BACKGROUND_PHOTO_FILENAMES: readonly string[];
}

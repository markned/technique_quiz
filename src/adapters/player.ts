export type PlayerAdapter = {
  load: (source: string) => Promise<void>;
  play: () => void;
  /** Для ожидания после смены трека (автовоспроизведение из таймеров). */
  playAsync: () => Promise<void>;
  pause: () => void;
  seekTo: (time: number) => void;
  /** После смены src — дождаться применения seek (иначе на части треков currentTime остаётся 0). */
  seekToAsync: (time: number) => Promise<void>;
  getCurrentTime: () => number;
  setVolume: (volume: number) => void;
  /** Нужен для старта с muted=true (политика браузера), затем снять при fade-in. */
  setMuted: (muted: boolean) => void;
  destroy?: () => void;
};

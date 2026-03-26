import type { PlayerAdapter } from "./player";

export class LocalMediaPlayer implements PlayerAdapter {
  private media: HTMLAudioElement;

  constructor() {
    this.media = new Audio();
    this.media.preload = "auto";
    // Не задаём crossOrigin: для same-origin статики без Access-Control-Allow-Origin часть браузеров
    // не декодирует/не играет трек (типично заметно на «новых» файлах после расширения базы).
    this.media.setAttribute("playsinline", "true");
  }

  async load(source: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const onReady = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`Failed to load media source: ${source}`));
      };
      const cleanup = () => {
        this.media.removeEventListener("canplay", onReady);
        this.media.removeEventListener("error", onError);
      };

      this.media.pause();
      this.media.muted = false;
      this.media.src = source;
      this.media.load();
      this.media.addEventListener("error", onError, { once: true });
      // canplay — буфер готов; только loadedmetadata недостаточно для стабильного seek на длинных mp3
      this.media.addEventListener("canplay", onReady, { once: true });
      if (this.media.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        queueMicrotask(onReady);
      }
    });
  }

  play(): void {
    void this.media.play();
  }

  playAsync(): Promise<void> {
    return this.media.play();
  }

  setMuted(muted: boolean): void {
    this.media.muted = muted;
  }

  pause(): void {
    this.media.pause();
  }

  seekTo(time: number): void {
    this.media.currentTime = Math.max(0, time);
  }

  seekToAsync(time: number): Promise<void> {
    const t = Math.max(0, time);
    return new Promise((resolve) => {
      const media = this.media;
      if (Math.abs(media.currentTime - t) < 0.05) {
        resolve();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        media.removeEventListener("seeked", onSeeked);
        window.clearTimeout(timeoutId);
        resolve();
      };
      const onSeeked = () => finish();
      const timeoutId = window.setTimeout(finish, 1200);
      media.addEventListener("seeked", onSeeked, { once: true });
      media.currentTime = t;
    });
  }

  getCurrentTime(): number {
    return this.media.currentTime || 0;
  }

  setVolume(volume: number): void {
    const v = Math.min(1, Math.max(0, volume));
    this.media.volume = v;
    if (v > 0.001) {
      this.media.muted = false;
    }
  }

  destroy(): void {
    this.media.pause();
    this.media.src = "";
    this.media.load();
  }
}

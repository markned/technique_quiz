import { useEffect, useRef, useState } from "react";
import { BACKGROUND_CROSSFADE_MS } from "../helpers/quizConfig";

type DualState = {
  a: string | null;
  b: string | null;
  showA: boolean;
};

function useDualCrossfade(current: string | null): DualState {
  const [state, setState] = useState<DualState>(() => ({
    a: current,
    b: null,
    showA: true,
  }));

  useEffect(() => {
    setState((prev) => {
      if (current == null) return { a: null, b: null, showA: true };
      const visible = prev.showA ? prev.a : prev.b;
      if (current === visible) return prev;
      if (prev.a === null && prev.b === null) {
        return { a: current, b: null, showA: true };
      }
      if (prev.showA) {
        return { ...prev, b: current, showA: false };
      }
      return { ...prev, a: current, showA: true };
    });
  }, [current]);

  return state;
}

type QuizBackgroundProps = {
  photoUrl: string | null;
  youtubeSrc: string | null;
  videoSrc: string | null;
  videoStartSec?: number;
  synchronizedAt?: number | null;
  synchronizedPausedAt?: number | null;
};

export function QuizBackground({
  photoUrl,
  youtubeSrc,
  videoSrc,
  videoStartSec = 0,
  synchronizedAt = null,
  synchronizedPausedAt = null,
}: QuizBackgroundProps) {
  const useVideo = !!videoSrc;
  const useYoutube = !useVideo && !!youtubeSrc;
  const photo = useDualCrossfade(photoUrl);

  const t = `${BACKGROUND_CROSSFADE_MS}ms`;
  const ease = "ease-in-out";

  return (
    <div className="quiz-bg-root">
      <div
        className="quiz-bg-surface quiz-bg-surface-photo"
        style={{
          opacity: useVideo || useYoutube ? 0 : 1,
          transition: `opacity ${t} ${ease}`,
        }}
      >
        <div className="photo-bg-stack">
          <div
            className="photo-bg-layer"
            style={{
              backgroundImage: photo.a ? `url("${photo.a}")` : undefined,
              opacity: photo.showA ? 0.45 : 0,
              transition: `opacity ${t} ${ease}`,
            }}
          />
          <div
            className="photo-bg-layer"
            style={{
              backgroundImage: photo.b ? `url("${photo.b}")` : undefined,
              opacity: photo.showA ? 0 : 0.45,
              transition: `opacity ${t} ${ease}`,
            }}
          />
        </div>
      </div>

      <div
        className="quiz-bg-surface quiz-bg-surface-youtube"
        style={{
          opacity: useYoutube ? 1 : 0,
          transition: `opacity ${t} ${ease}`,
        }}
      >
        {youtubeSrc ? (
          <div className="youtube-bg-dual">
            <div className="youtube-bg-wrap youtube-bg-wrap-layer">
              {synchronizedAt !== null ? (
                <SynchronizedYoutube
                  src={youtubeSrc}
                  synchronizedAt={synchronizedAt}
                  pausedAt={synchronizedPausedAt}
                />
              ) : (
                <iframe
                  key={youtubeSrc}
                  className="youtube-bg"
                  src={youtubeSrc}
                  title="Фоновое видео YouTube"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                  allowFullScreen
                  loading="eager"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              )}
            </div>
            <div className="youtube-bg-dim-scrim" aria-hidden />
          </div>
        ) : null}
      </div>

      <div
        className="quiz-bg-surface quiz-bg-surface-youtube"
        style={{
          opacity: useVideo ? 1 : 0,
          transition: `opacity ${t} ${ease}`,
        }}
      >
        {useVideo && videoSrc ? (
          <div className="youtube-bg-dual">
            <div className="youtube-bg-wrap youtube-bg-wrap-layer">
              <BackgroundVideo
                key={videoSrc}
                src={videoSrc}
                startSec={videoStartSec}
                synchronizedAt={synchronizedAt}
                pausedAt={synchronizedPausedAt}
              />
            </div>
            <div className="youtube-bg-dim-scrim" aria-hidden />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BackgroundVideo({
  src,
  startSec,
  synchronizedAt,
  pausedAt,
}: {
  src: string;
  startSec: number;
  synchronizedAt: number | null;
  pausedAt: number | null;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const synchronize = () => {
      if (!el.duration || !Number.isFinite(el.duration)) return;
      const elapsed =
        synchronizedAt === null ? 0 : Math.max(0, ((pausedAt ?? Date.now()) - synchronizedAt) / 1000);
      const target = (startSec + elapsed) % el.duration;
      if (synchronizedAt === null || Math.abs(el.currentTime - target) > 0.6) el.currentTime = target;
      if (pausedAt !== null) el.pause();
      else if (el.paused) void el.play().catch(() => {});
    };
    el.addEventListener("loadedmetadata", synchronize);
    synchronize();
    const interval = synchronizedAt === null ? undefined : window.setInterval(synchronize, 1000);
    return () => {
      el.removeEventListener("loadedmetadata", synchronize);
      window.clearInterval(interval);
    };
  }, [src, startSec, synchronizedAt, pausedAt]);
  return (
    <video
      ref={ref}
      className="youtube-bg quiz-bg-video"
      src={src}
      autoPlay
      muted
      playsInline
      loop
      preload="auto"
    />
  );
}

type YoutubePlayer = {
  getDuration(): number;
  getCurrentTime(): number;
  seekTo(time: number, ahead: boolean): void;
  mute(): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
};
type YoutubeApi = {
  Player: new (frame: HTMLIFrameElement, options: { events: { onReady(): void } }) => YoutubePlayer;
};
function SynchronizedYoutube({
  src,
  synchronizedAt,
  pausedAt,
}: {
  src: string;
  synchronizedAt: number;
  pausedAt: number | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timing = useRef({ synchronizedAt, pausedAt });
  timing.current = { synchronizedAt, pausedAt };
  useEffect(() => {
    const globals = window as unknown as { YT?: YoutubeApi };
    const frame = document.createElement("iframe");
    const embed = new URL(src);
    embed.searchParams.set("enablejsapi", "1");
    embed.searchParams.set("origin", window.location.origin);
    frame.src = embed.toString();
    frame.className = "youtube-bg";
    frame.title = "Фоновое видео YouTube";
    frame.allow = "autoplay; encrypted-media; fullscreen";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    ref.current?.append(frame);
    let player: YoutubePlayer | undefined;
    let sync: number | undefined;
    let attempts = 0;
    if (!globals.YT && !document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.append(script);
    }
    const initialize = () => {
      if (!globals.YT?.Player || !ref.current) return false;
      player = new globals.YT.Player(frame, {
        events: {
          onReady: () => {
            const synchronize = () => {
              if (!player) return;
              const duration = player.getDuration();
              const { synchronizedAt: start, pausedAt: pause } = timing.current;
              const target =
                (Number(new URL(src).searchParams.get("start") ?? 0) +
                  Math.max(0, ((pause ?? Date.now()) - start) / 1000)) %
                duration;
              player.mute();
              if (duration > 0 && Math.abs(player.getCurrentTime() - target) > 0.8)
                player.seekTo(target, true);
              if (pause !== null) player.pauseVideo();
              else player.playVideo();
            };
            synchronize();
            sync = window.setInterval(synchronize, 1000);
          },
        },
      });
      return true;
    };
    const ready = window.setInterval(() => {
      if (initialize() || ++attempts >= 150) window.clearInterval(ready);
    }, 100);
    return () => {
      window.clearInterval(ready);
      window.clearInterval(sync);
      player?.destroy();
      frame.remove();
    };
  }, [src]);
  return <div ref={ref} style={{ position: "absolute", inset: 0 }} />;
}

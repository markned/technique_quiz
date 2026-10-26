import { useEffect, useRef, useState } from "react";
import { LocalMediaPlayer } from "../adapters/localMediaPlayer";
import { unlockAudioFromGesture } from "../lib/audioUnlock";
import { subscribeMasterVolume } from "../lib/masterVolume";
import { toLocalMediaUrl } from "../helpers/media";
import { fragmentStopTimeSec } from "../helpers/quizConfig";
import type { ClientMessage } from "./messages";
import type { PrivatePlayerState, PublicRoomState } from "./types";

export function useOnlineAudio(
  state: PublicRoomState | null,
  playerId: string | undefined,
  own: PrivatePlayerState | undefined,
  send: (m: ClientMessage) => boolean,
) {
  const player = useRef<LocalMediaPlayer | null>(null);
  const loaded = useRef("");
  const [loadedTurn, setLoadedTurn] = useState("");
  const [error, setError] = useState("");
  const round = state?.round;
  const turn = state?.turnId;
  const phase = state?.phase;
  const online = !!state?.online;
  const fixture =
    online &&
    !!state?.code.startsWith("E2E") &&
    (import.meta.env.DEV || import.meta.env.VITE_PRIVATE_TESTING === "1");
  const eligible = !!playerId && !!state?.online?.eligiblePlayerIds.includes(playerId);
  const replay = own?.personalReplay;
  const replayId = replay?.id;
  const source = round ? toLocalMediaUrl(round) : null;
  const start = round?.start;
  const stop = round ? fragmentStopTimeSec(round.end) : undefined;
  const preparing = phase === "transition";
  const playingStartedAt = state?.playingStartedAt ?? null;
  const replayStartedAt = replay?.startedAt ?? null;
  const replayEndsAt = replay?.endsAt ?? null;
  const timing = useRef({ playingStartedAt, replayStartedAt, replayEndsAt });
  // Clock estimates may improve on heartbeats; update the next seek without restarting live audio.
  useEffect(() => {
    timing.current = { playingStartedAt, replayStartedAt, replayEndsAt };
  }, [playingStartedAt, replayStartedAt, replayEndsAt]);
  useEffect(() => {
    const unsubscribe = subscribeMasterVolume(() => player.current?.refreshMasterVolume());
    return () => {
      unsubscribe();
      player.current?.destroy();
      player.current = null;
    };
  }, []);
  useEffect(() => {
    if (
      !online ||
      !source ||
      start === undefined ||
      !turn ||
      loaded.current === turn ||
      (!preparing && !eligible)
    )
      return;
    let disposed = false;
    const media = (player.current ??= new LocalMediaPlayer());
    loaded.current = "";
    setError("");
    const load = async () => {
      try {
        if (!fixture) {
          await media.load(source);
          await media.seekToAsync(start);
        }
        if (disposed) return;
        loaded.current = turn;
        setLoadedTurn(turn);
        if (preparing) send({ type: "player_media_ready", turnId: turn });
      } catch {
        if (!disposed) {
          setError("Фрагмент не загрузился. Этот раунд будет пропущен.");
          send({ type: "player_media_failed", turnId: turn });
        }
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [online, preparing, turn, source, start, eligible, fixture, send]);
  useEffect(() => {
    if (!online || start === undefined || stop === undefined || !turn || fixture) return;
    const media = player.current;
    if (!media || loaded.current !== turn || !eligible) {
      media?.pause();
      return;
    }
    const clock = timing.current;
    const replaying =
      clock.replayStartedAt !== null &&
      clock.replayEndsAt !== null &&
      clock.replayEndsAt > Date.now() &&
      ["quiz_answering", "freestyle_submitting"].includes(phase ?? "");
    const result = phase === "round_results";
    if (phase !== "playing" && !replaying && !result) {
      media.pause();
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startAt = replaying ? clock.replayStartedAt! : result ? Date.now() : clock.playingStartedAt!;
    const play = async () => {
      try {
        const elapsed = Math.max(0, (Date.now() - startAt) / 1000);
        const stopAt = stop;
        await media.seekToAsync(result ? stopAt : Math.min(stopAt, start + elapsed));
        if (disposed || (!result && start + elapsed >= stopAt)) return;
        media.setVolume(1);
        media.setMuted(false);
        await media.playAsync();
        if (disposed) {
          media.pause();
          return;
        }
        setError("");
        const wallElapsed = Math.max(0, (Date.now() - startAt) / 1000);
        if (!result && Math.abs(media.getCurrentTime() - (start + wallElapsed)) > 0.2)
          media.seekTo(Math.min(stopAt, start + wallElapsed));
        timer = setTimeout(
          () => media.pause(),
          result ? 6000 : Math.max(0, stopAt - start - wallElapsed) * 1000,
        );
      } catch {
        if (!disposed) {
          if (result) {
            setError("Не удалось проиграть оригинал.");
            return;
          }
          setError("Звук недоступен. Нажми «Включить звук»; текущий раунд пропущен.");
          send({ type: "player_media_failed", turnId: turn });
        }
      }
    };
    timer = setTimeout(() => void play(), Math.max(0, startAt - Date.now()));
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      media.pause();
    };
  }, [online, phase, turn, loadedTurn, eligible, replayId, fixture, send, start, stop]);
  const unlock = async () => {
    unlockAudioFromGesture();
    if (!fixture) await (player.current ??= new LocalMediaPlayer()).unlockFromGesture();
    setError("");
  };
  return { error, unlock };
}

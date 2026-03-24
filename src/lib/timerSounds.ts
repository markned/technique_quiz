import { TIMER_COUNT_SOUND, TIMER_END_SOUND } from "../helpers/quizConfig";

const TICK_BASE_VOL = 0.5;
const END_BASE_VOL = 0.8;

let timerSoundsDucked = false;
const activeTickAudios = new Set<HTMLAudioElement>();

export function stopAllTimerCountSounds(): void {
  const list = [...activeTickAudios];
  activeTickAudios.clear();
  for (const a of list) {
    try {
      a.pause();
      a.currentTime = 0;
    } catch {
      /* ignore */
    }
  }
}

export function setTimerSoundsDucked(ducked: boolean): void {
  timerSoundsDucked = ducked;
  if (ducked) {
    stopAllTimerCountSounds();
  }
}

export function playTimerEndSound(): void {
  stopAllTimerCountSounds();
  const a = new Audio(TIMER_END_SOUND);
  a.volume = timerSoundsDucked ? 0 : END_BASE_VOL;
  void a.play();
}

export function playTimerTickSound(): void {
  if (timerSoundsDucked) {
    return;
  }
  stopAllTimerCountSounds();
  const a = new Audio(TIMER_COUNT_SOUND);
  a.volume = TICK_BASE_VOL;
  activeTickAudios.add(a);
  const onDone = () => {
    activeTickAudios.delete(a);
    a.removeEventListener("ended", onDone);
  };
  a.addEventListener("ended", onDone);
  void a.play().catch(() => {
    activeTickAudios.delete(a);
  });
}

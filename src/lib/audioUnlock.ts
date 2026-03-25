/**
 * Браузеры (особенно Safari / iOS) блокируют звук без «жеста» пользователя.
 * Первый pointerdown/keydown снимает блокировку; до этого HTMLAudioElement.play() и AudioContext часто тихо падают.
 */

let sharedCtx: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext | null {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) {
      return null;
    }
    if (!sharedCtx || sharedCtx.state === "closed") {
      sharedCtx = new Ctx();
    }
    return sharedCtx;
  } catch {
    return null;
  }
}

export function resumeSharedAudioContext(): Promise<void> {
  const ctx = getSharedAudioContext();
  if (!ctx) {
    return Promise.resolve();
  }
  if (ctx.state === "suspended") {
    return ctx.resume();
  }
  return Promise.resolve();
}

let unlocked = false;
const pending = new Set<() => void>();

export function isAudioUnlocked(): boolean {
  return unlocked;
}

export function whenAudioUnlocked(fn: () => void): () => void {
  if (unlocked) {
    fn();
    return () => {};
  }
  pending.add(fn);
  return () => {
    pending.delete(fn);
  };
}

function flushPending(): void {
  for (const fn of pending) {
    fn();
  }
  pending.clear();
}

export function unlockAudioFromGesture(): void {
  if (unlocked) {
    return;
  }
  unlocked = true;
  void resumeSharedAudioContext();
  flushPending();
}

/** Вызвать из main до рендера приложения: первый тап/клавиша разблокирует звук. */
export function registerGlobalAudioUnlock(): void {
  const handler = () => {
    unlockAudioFromGesture();
    document.removeEventListener("pointerdown", handler, true);
    document.removeEventListener("keydown", handler, true);
  };
  document.addEventListener("pointerdown", handler, { capture: true, passive: true });
  document.addEventListener("keydown", handler, { capture: true });
}

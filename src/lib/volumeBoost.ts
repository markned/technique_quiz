const VOLUME_BOOST = 1.25;

/**
 * Подключает усиление громкости (+25%) к медиа-элементу через Web Audio API.
 */
export function boostVolume(element: HTMLMediaElement): void {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
    const source = ctx.createMediaElementSource(element);
    const gain = ctx.createGain();
    gain.gain.value = VOLUME_BOOST;
    source.connect(gain);
    gain.connect(ctx.destination);
    if (ctx.state === "suspended") {
      ctx.resume();
    }
  } catch {
    // fallback: без усиления
  }
}

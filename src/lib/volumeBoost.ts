const VOLUME_BOOST = 1.25;
/** Озвучка правил: +25% кино + 150% от этой базы ≈ 1.875× к исходному сигналу */
const RULES_LOUDNESS = 1.5;

function connectBoost(element: HTMLMediaElement, gainValue: number): void {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
    const source = ctx.createMediaElementSource(element);
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    source.connect(gain);
    gain.connect(ctx.destination);
    if (ctx.state === "suspended") {
      ctx.resume();
    }
  } catch {
    // fallback: без усиления
  }
}

/** Intro / outro */
export function boostVolume(element: HTMLMediaElement): void {
  connectBoost(element, VOLUME_BOOST);
}

/** Озвучка правил: громче на 150% относительно прежнего уровня (+ кино-бусту). */
export function boostRulesNarration(element: HTMLMediaElement): void {
  connectBoost(element, VOLUME_BOOST * RULES_LOUDNESS);
}

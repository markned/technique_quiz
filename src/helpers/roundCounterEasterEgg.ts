import type { Round } from "../types";

/** Пасхалка: раунд «Гитлер» — счётчик 14/88 вместо N/M. */
export function roundCounterEasterEggLabel(round: Round): string | null {
  const t = round.title.trim().replace(/\s+/g, " ").toLowerCase();
  return t === "гитлер" ? "14/88" : null;
}

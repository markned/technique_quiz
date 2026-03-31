import { rounds as allRounds } from "../content/rounds";
import type { Round } from "../types";

/** Не скрытые раунды из базы — порядок сессии строится поверх этого списка. */
export function visibleRoundsForSession(): Round[] {
  return allRounds.filter((r) => !r.hidden);
}

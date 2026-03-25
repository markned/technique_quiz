import type { Round } from "../types";
import { reorderNoConsecutiveSameTitle, shuffle } from "./media";

/**
 * Раунды идут по возрастанию «сложности» (число строк в ответе: 1, затем 2, затем 3…),
 * внутри каждой ступени порядок случайный, с разведением одинаковых названий подряд, если возможно.
 */
export function shuffleWithinDifficultyBuckets(source: Round[]): Round[] {
  const sorted = [...source].sort((a, b) => {
    const byReveal = a.revealLineIds.length - b.revealLineIds.length;
    if (byReveal !== 0) {
      return byReveal;
    }
    return a.id - b.id;
  });

  const buckets = new Map<number, Round[]>();
  for (const r of sorted) {
    const k = r.revealLineIds.length;
    if (!buckets.has(k)) {
      buckets.set(k, []);
    }
    buckets.get(k)!.push(r);
  }

  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const result: Round[] = [];
  for (const k of keys) {
    const bucket = buckets.get(k)!;
    const shuffled = shuffle([...bucket]);
    result.push(...reorderNoConsecutiveSameTitle(shuffled));
  }
  return result;
}

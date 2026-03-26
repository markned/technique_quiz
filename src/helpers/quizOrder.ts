import type { Round } from "../types";
import { DEFAULT_QUIZ_SESSION_LENGTH } from "./quizConfig";
import { reorderNoConsecutiveSameTitle, shuffle } from "./shuffle";

/** Ответ из нескольких строк (для «сложного» хвоста сессии). */
export function isMultiLineRevealRound(r: Round): boolean {
  return r.revealLineIds.length >= 2;
}

/** Последние N раундов сессии — только многострочный ответ. */
const HARD_TAIL_ROUND_COUNT = 4;

function rotateUntilDifferentFromLast(head: Round[], tail: Round[]): Round[] {
  if (head.length === 0 || tail.length === 0) return tail;
  const lastTitle = head[head.length - 1]!.title;
  let t = [...tail];
  for (let i = 0; i < t.length; i++) {
    if (t[0]!.title !== lastTitle) return t;
    t = [...t.slice(1), t[0]!];
  }
  return t;
}

/**
 * Сессия: сначала более простые раунды (как в {@link shuffleWithinDifficultyBuckets}), последние
 * {@link HARD_TAIL_ROUND_COUNT} — только с ответом из двух и более строк.
 */
export function buildSessionPlayOrder(visible: Round[]): Round[] {
  const sessionLen = DEFAULT_QUIZ_SESSION_LENGTH;
  const headLen = sessionLen - HARD_TAIL_ROUND_COUNT;

  const multi = visible.filter(isMultiLineRevealRound);
  if (multi.length < HARD_TAIL_ROUND_COUNT) {
    return shuffleWithinDifficultyBuckets([...visible]).slice(0, sessionLen);
  }

  const tailPick = shuffle([...multi]).slice(0, HARD_TAIL_ROUND_COUNT);
  const tailIds = new Set(tailPick.map((r) => r.id));
  const headPool = visible.filter((r) => !tailIds.has(r.id));

  const headOrdered = shuffleWithinDifficultyBuckets(headPool);
  const head = headOrdered.slice(0, headLen);
  const tail = rotateUntilDifferentFromLast(head, shuffle([...tailPick]));

  return [...head, ...tail];
}

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

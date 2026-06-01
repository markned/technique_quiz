import { rounds as allRounds } from "../content/rounds";
import type { Round } from "../types";
import { buildQuizMcOptions, getQuizUiVariant, revealAnswerText } from "../helpers/quizOptions";
import { shuffle, shuffleUntilOrderDiffers } from "../helpers/shuffle";
import { MULTIPLAYER_FREESTYLE_SESSION_LENGTH, MULTIPLAYER_SESSION_LENGTH } from "./types";

function visibleRounds(): Round[] {
  return allRounds.filter((round) => !round.hidden);
}

function isMultiLineRevealRound(round: Round): boolean {
  return round.revealLineIds.length >= 2;
}

function buildQuizEligiblePool(visible: Round[]): Round[] {
  return visible.filter((round) => !round.hidden && round.revealLineIds.length >= 1);
}

function buildFreestyleEligiblePool(visible: Round[]): Round[] {
  return visible.filter((round) => !round.hidden && round.revealLineIds.length === 1);
}

function shuffleWithinDifficultyBuckets(source: Round[]): Round[] {
  const buckets = new Map<number, Round[]>();
  for (const round of [...source].sort(
    (a, b) => a.revealLineIds.length - b.revealLineIds.length || a.id - b.id,
  )) {
    const key = round.revealLineIds.length;
    buckets.set(key, [...(buckets.get(key) ?? []), round]);
  }
  return [...buckets.keys()].sort((a, b) => a - b).flatMap((key) => shuffle(buckets.get(key) ?? []));
}

export function buildMultiplayerRoundOrder(mode: "freestyle" | "quiz"): Round[] {
  if (mode === "freestyle") {
    return shuffleWithinDifficultyBuckets(buildFreestyleEligiblePool(visibleRounds())).slice(
      0,
      MULTIPLAYER_FREESTYLE_SESSION_LENGTH,
    );
  }

  const pool = buildQuizEligiblePool(visibleRounds());
  if (pool.length <= MULTIPLAYER_SESSION_LENGTH) return shuffleWithinDifficultyBuckets(pool);

  const hardTailCount = 4;
  const multi = pool.filter(isMultiLineRevealRound);
  if (multi.length < hardTailCount) {
    return shuffleWithinDifficultyBuckets(pool).slice(0, MULTIPLAYER_SESSION_LENGTH);
  }

  const tail = shuffle(multi).slice(0, hardTailCount);
  const tailIds = new Set(tail.map((round) => round.id));
  const head = shuffleWithinDifficultyBuckets(pool.filter((round) => !tailIds.has(round.id))).slice(
    0,
    MULTIPLAYER_SESSION_LENGTH - hardTailCount,
  );
  return [...head, ...shuffle(tail)];
}

export function roundById(roundId: number | null): Round | null {
  if (roundId === null) return null;
  return allRounds.find((round) => round.id === roundId) ?? null;
}

export function buildQuizRoundPayload(
  round: Round,
  priorCorrectAnswers: ReadonlySet<string>,
): {
  variant: ReturnType<typeof getQuizUiVariant>;
  options: string[];
  correctIndex: number;
  orderLineIds: number[];
  correctOrderIds: number[];
  correctAnswer: string;
} {
  const variant = getQuizUiVariant(round);
  if (variant === "mc4") {
    const built = buildQuizMcOptions(round, buildQuizEligiblePool(visibleRounds()), priorCorrectAnswers);
    return {
      variant,
      options: built.options,
      correctIndex: built.correctIndex,
      orderLineIds: [],
      correctOrderIds: round.revealLineIds,
      correctAnswer: revealAnswerText(round),
    };
  }
  if (variant === "order") {
    return {
      variant,
      options: [],
      correctIndex: 0,
      orderLineIds: shuffleUntilOrderDiffers(round.revealLineIds),
      correctOrderIds: round.revealLineIds,
      correctAnswer: revealAnswerText(round),
    };
  }
  return {
    variant,
    options: [],
    correctIndex: 0,
    orderLineIds: [],
    correctOrderIds: round.revealLineIds,
    correctAnswer: revealAnswerText(round),
  };
}

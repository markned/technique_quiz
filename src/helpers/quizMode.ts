import type { Round } from "../types";
import { DEFAULT_QUIZ_SESSION_LENGTH, FREESTYLE_SESSION_LENGTH } from "./quizConfig";
import { buildFreestyleSessionPlayOrder, buildSessionPlayOrder } from "./quizOrder";
import {
  applyRoundExclusion,
  loadExcludedRoundIdsForNextSession,
} from "./sessionPlayExclusion";

/** Раунд подходит для режима «Викторина» (есть хотя бы одна строка ответа). */
export function isQuizEligibleRevealRound(r: Round): boolean {
  return r.revealLineIds.length >= 1;
}

export function buildQuizEligiblePool(visible: Round[]): Round[] {
  return visible.filter((r) => !r.hidden && isQuizEligibleRevealRound(r));
}

/** Как во фристайле: по возрастанию «сложности» (число строк ответа), хвост сессии — многострочные ответы. */
export function buildQuizSessionPlayOrder(visible: Round[]): Round[] {
  const pool = buildQuizEligiblePool(visible);
  if (pool.length === 0) return [];
  return buildSessionPlayOrder(pool);
}

/** Викторина с учётом недавних раундов (последние две игры). */
export function buildNextQuizSessionPlayOrder(visible: Round[]): Round[] {
  const excluded = loadExcludedRoundIdsForNextSession();
  const eligible = buildQuizEligiblePool(visible);
  const pool = applyRoundExclusion(eligible, excluded, DEFAULT_QUIZ_SESSION_LENGTH);
  return buildQuizSessionPlayOrder(pool);
}

/** Фристайл: 8 раундов, один сложный в конце; без повторов с последних двух игр, если возможно. */
export function buildNextFreestyleSessionPlayOrder(visible: Round[]): Round[] {
  const excluded = loadExcludedRoundIdsForNextSession();
  const pool = applyRoundExclusion(visible, excluded, FREESTYLE_SESSION_LENGTH);
  return buildFreestyleSessionPlayOrder(pool);
}

import type { Round } from "../types";
import { pickLyricLines } from "./lyrics";
import { shuffle } from "./shuffle";

export function revealAnswerText(r: Round): string {
  const lines = pickLyricLines(r.lyrics, r.revealLineIds);
  return lines.map((l) => l.text).join("\n");
}

/** Одна или две строки — 4 варианта; три и больше — режим порядка строк (не MC). */
export type QuizUiVariant = "mc4" | "order";

export function getQuizUiVariant(round: Round): QuizUiVariant | null {
  const n = round.revealLineIds.length;
  if (n < 1) return null;
  if (n <= 2) return "mc4";
  return "order";
}

/**
 * Четыре варианта для ответа в одну строку: правильный + три отличных от других однострочных раундов.
 * `priorCorrectAnswers` — тексты ответов по уже завершённым раундам (после показа правильного ответа); не используются как дистракторы.
 */
export function buildQuizOptionsOneLine(
  round: Round,
  distractorPool: Round[],
  priorCorrectAnswers?: ReadonlySet<string>,
): { options: string[]; correctIndex: number } {
  const correct = revealAnswerText(round);
  const prior = priorCorrectAnswers ?? new Set<string>();
  const wrongCandidates = distractorPool
    .filter((r) => r.id !== round.id && r.revealLineIds.length === 1)
    .map((r) => revealAnswerText(r))
    .filter((t) => t !== correct && !prior.has(t));

  const uniqueShuffled = shuffle([...new Set(wrongCandidates)]);
  const wrong: string[] = [];
  for (const t of uniqueShuffled) {
    if (wrong.length >= 3) break;
    wrong.push(t);
  }

  const fb = shuffle([...wrongCandidates]);
  let fi = 0;
  while (wrong.length < 3 && fb.length > 0) {
    const t = fb[fi % fb.length]!;
    fi += 1;
    if (t === correct || prior.has(t)) continue;
    if (!wrong.includes(t)) wrong.push(t);
  }

  while (wrong.length < 3) {
    wrong.push(wrong[wrong.length - 1] ?? "…");
  }

  const options = shuffle([correct, wrong[0]!, wrong[1]!, wrong[2]!]);
  const correctIndex = options.findIndex((o) => o === correct);
  return { options, correctIndex: correctIndex >= 0 ? correctIndex : 0 };
}

/** Собирает MC: одна строка ответа или две (неверные: случайно 1–2 полных двухстрочных + склейки однострочных). */
export function buildQuizMcOptions(
  round: Round,
  distractorPool: Round[],
  priorCorrectAnswers?: ReadonlySet<string>,
): { options: string[]; correctIndex: number } {
  const n = round.revealLineIds.length;
  if (n === 1) {
    return buildQuizOptionsOneLine(round, distractorPool, priorCorrectAnswers);
  }
  return buildQuizOptionsTwoLine(round, distractorPool, priorCorrectAnswers);
}

/** Склейка двух разных однострочных ответов в «двухстрочный» вариант. */
function buildGluedDistractorFromOneLiners(
  pool: Round[],
  excludeId: number,
  correct: string,
  used: Set<string>,
  prior: ReadonlySet<string>,
): string | null {
  const singles = pool.filter((r) => r.id !== excludeId && r.revealLineIds.length === 1);
  if (singles.length < 2) return null;
  for (let attempt = 0; attempt < 36; attempt++) {
    const order = shuffle([...singles]);
    const a = revealAnswerText(order[0]!);
    const b = revealAnswerText(order[1]!);
    if (!a || !b || a === b) continue;
    const cross1 = `${a}\n${b}`;
    const cross2 = `${b}\n${a}`;
    const pick = Math.random() < 0.5 ? cross1 : cross2;
    if (pick !== correct && !used.has(pick) && !prior.has(pick)) return pick;
  }
  return null;
}

/** Резерв: склейка половинок из двух чужих двухстрочных раундов. */
function buildMergedHalvesFromTwoLineRounds(
  pool: Round[],
  excludeId: number,
  correct: string,
  used: Set<string>,
  prior: ReadonlySet<string>,
): string | null {
  const others = pool.filter((r) => r.id !== excludeId && r.revealLineIds.length === 2);
  if (others.length < 2) return null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const sh = shuffle([...others]);
    const a = sh[0]!;
    const b = sh[1]!;
    const la = pickLyricLines(a.lyrics, a.revealLineIds);
    const lb = pickLyricLines(b.lyrics, b.revealLineIds);
    if (la.length < 2 || lb.length < 2) continue;
    const pick = Math.random() < 0.5 ? `${la[0].text}\n${lb[1].text}` : `${lb[0].text}\n${la[1].text}`;
    if (pick !== correct && !used.has(pick) && !prior.has(pick)) return pick;
  }
  return null;
}

/**
 * Четыре варианта: правильный (две строки) + среди неверных случайно от 1 до 2 полноценных
 * двухстрочных ответов из других раундов; остальные неверные — склейка двух однострочных ответов.
 */
export function buildQuizOptionsTwoLine(
  round: Round,
  distractorPool: Round[],
  priorCorrectAnswers?: ReadonlySet<string>,
): { options: string[]; correctIndex: number } {
  const correct = revealAnswerText(round);
  const prior = priorCorrectAnswers ?? new Set<string>();
  const twoLineTexts = shuffle(
    [
      ...new Set(
        distractorPool
          .filter((r) => r.id !== round.id && r.revealLineIds.length === 2)
          .map((r) => revealAnswerText(r))
          .filter((t) => t !== correct && !prior.has(t)),
      ),
    ],
  );

  const maxTwoLineWrong = Math.min(2, twoLineTexts.length);
  const twoLineWrongCount =
    maxTwoLineWrong === 0 ? 0 : 1 + Math.floor(Math.random() * maxTwoLineWrong);

  const wrong: string[] = [];
  const used = new Set<string>();

  for (let i = 0; i < twoLineWrongCount; i++) {
    const t = twoLineTexts[i];
    if (t && !used.has(t)) {
      wrong.push(t);
      used.add(t);
    }
  }

  let fillGuard = 0;
  while (wrong.length < 3 && fillGuard < 120) {
    fillGuard += 1;
    let next = buildGluedDistractorFromOneLiners(distractorPool, round.id, correct, used, prior);
    if (!next) {
      next = buildMergedHalvesFromTwoLineRounds(distractorPool, round.id, correct, used, prior);
    }
    if (next && !used.has(next)) {
      wrong.push(next);
      used.add(next);
      continue;
    }
    const leftover = twoLineTexts.find((t) => !used.has(t));
    if (leftover) {
      wrong.push(leftover);
      used.add(leftover);
      continue;
    }
    const fb = `…${fillGuard}`;
    wrong.push(fb);
    used.add(fb);
  }

  while (wrong.length < 3) {
    wrong.push("…");
  }

  const options = shuffle([correct, wrong[0]!, wrong[1]!, wrong[2]!]);
  const correctIndex = options.findIndex((o) => o === correct);
  return { options, correctIndex: correctIndex >= 0 ? correctIndex : 0 };
}

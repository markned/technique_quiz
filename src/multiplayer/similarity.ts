const CYR_TO_LATIN: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

export type SimilarityBreakdown = {
  normalizedA: string;
  normalizedB: string;
  transliteratedA: string;
  transliteratedB: string;
  dice: number;
  jaccard: number;
  levenshtein: number;
  score: number;
};

export function normalizeAnswerText(input: string): string {
  return input
    .toLocaleLowerCase("ru-RU")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ё/g, "е")
    .replace(/[^\p{Letter}\p{Number}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function transliterateCyrillic(input: string): string {
  return [...input].map((ch) => CYR_TO_LATIN[ch] ?? ch).join("");
}

function bigrams(input: string): string[] {
  const compact = input.replace(/\s+/g, " ");
  if (compact.length <= 1) return compact ? [compact] : [];
  const result: string[] = [];
  for (let i = 0; i < compact.length - 1; i += 1) {
    result.push(compact.slice(i, i + 2));
  }
  return result;
}

function diceCoefficient(a: string, b: string): number {
  const aa = bigrams(a);
  const bb = bigrams(b);
  if (aa.length === 0 && bb.length === 0) return 1;
  if (aa.length === 0 || bb.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const item of aa) counts.set(item, (counts.get(item) ?? 0) + 1);
  let overlap = 0;
  for (const item of bb) {
    const n = counts.get(item) ?? 0;
    if (n > 0) {
      overlap += 1;
      counts.set(item, n - 1);
    }
  }
  return (2 * overlap) / (aa.length + bb.length);
}

function tokenJaccard(a: string, b: string): number {
  const aa = new Set(a.split(" ").filter(Boolean));
  const bb = new Set(b.split(" ").filter(Boolean));
  if (aa.size === 0 && bb.size === 0) return 1;
  const union = new Set([...aa, ...bb]);
  let intersection = 0;
  for (const token of aa) {
    if (bb.has(token)) intersection += 1;
  }
  return intersection / union.size;
}

function levenshteinDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j < curr.length; j += 1) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

export function compareAnswerSimilarity(a: string, b: string): SimilarityBreakdown {
  const normalizedA = normalizeAnswerText(a);
  const normalizedB = normalizeAnswerText(b);
  const transliteratedA = transliterateCyrillic(normalizedA);
  const transliteratedB = transliterateCyrillic(normalizedB);
  const leftA = normalizedA === transliteratedA ? normalizedA : `${normalizedA} ${transliteratedA}`;
  const leftB = normalizedB === transliteratedB ? normalizedB : `${normalizedB} ${transliteratedB}`;
  const dice = Math.max(
    diceCoefficient(normalizedA, normalizedB),
    diceCoefficient(transliteratedA, transliteratedB),
  );
  const jaccard = Math.max(tokenJaccard(normalizedA, normalizedB), tokenJaccard(leftA, leftB));
  const levenshtein = Math.max(
    levenshteinSimilarity(normalizedA, normalizedB),
    levenshteinSimilarity(transliteratedA, transliteratedB),
  );
  const score = Math.max(0, Math.min(1, dice * 0.4 + jaccard * 0.3 + levenshtein * 0.3));
  return {
    normalizedA,
    normalizedB,
    transliteratedA,
    transliteratedB,
    dice,
    jaccard,
    levenshtein,
    score,
  };
}

export function isSimilarityBonus(submission: string, original: string, threshold = 0.5): boolean {
  return compareAnswerSimilarity(submission, original).score >= threshold;
}

// F2 (US30 Nov 5 brief): the coach may only state the grade printed on the card.

export type CardGrade = "A+" | "A" | "B" | "C";

const PATTERNS: RegExp[] = [
  /\bgrade[ds]?\s+(?:(?:as|is|was|of|to|at|an?|it)\s+)*(A\+|A|B|C)(?![\w+])/g,
  /(?<![\w+])(A\+|A|B|C)[- ](?:grade|graded|setup|card)\b/g,
  /\b(?:is|was|really|actually|maps?\s+to)\s+an?\s+(A\+|A|B|C)(?![\w+])/g,
];

/** Grade letters the text states about a card. */
export function statedGrades(text: string): CardGrade[] {
  const out: CardGrade[] = [];
  for (const re of PATTERNS) for (const m of text.matchAll(re)) out.push(m[1] as CardGrade);
  return out;
}

/** Returns a correction when the text states a grade different from the card's. */
export function cardGradeCorrection(text: string, cardGrade: string | null | undefined): string | null {
  if (!cardGrade || !["A+", "A", "B", "C"].includes(cardGrade)) return null;
  const wrong = statedGrades(text).filter(g => g !== cardGrade);
  if (!wrong.length) return null;
  return `\n\nCorrection: the card's grade is ${cardGrade}. Any other grade mentioned above for this card is wrong; the card is the record.`;
}

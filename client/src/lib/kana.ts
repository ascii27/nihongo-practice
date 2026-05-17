// Normalize user input for conjugation grading.
//   - Trim whitespace
//   - NFKC normalize (collapses fullwidth digits/letters, harmonizes compatibility chars)
//   - Convert katakana to hiragana
// We do NOT romaji→kana; users are expected to use a Japanese IME.

const KATAKANA_TO_HIRAGANA = (s: string): string =>
  s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));

export function normalizeKana(input: string): string {
  return KATAKANA_TO_HIRAGANA(input.normalize("NFKC").trim());
}

export function answerMatches(given: string, expected: string, alternates: readonly string[] = []): boolean {
  const g = normalizeKana(given);
  if (g.length === 0) return false;
  if (normalizeKana(expected) === g) return true;
  return alternates.some((a) => normalizeKana(a) === g);
}

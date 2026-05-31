import type { Skill } from "@nihongo/shared";

export type ItemDisplay = {
  front: string;     // primary label (word / pattern / particle / verb)
  reading: string | null;
  meaning: string;   // short English/Japanese gloss
};

// Strip <ruby>/<rt> wrappers to plain text — used when only a ruby field exists.
function stripRuby(html: string): string {
  return html
    .replace(/<rt>[^<]*<\/rt>/g, "")
    .replace(/<[^>]*>/g, "")
    .trim();
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Derive Browse/Stats display fields from a skill's prompt+answer JSON. The
// stored shapes match @nihongo/shared (VocabPrompt, GrammarAnswer, …); this is
// the single place that knows how to summarize each skill into one row.
export function itemDisplay(skill: Skill, prompt: unknown, answer: unknown): ItemDisplay {
  const p = (prompt ?? {}) as Record<string, unknown>;
  const a = (answer ?? {}) as Record<string, unknown>;

  switch (skill) {
    case "vocab":
      return {
        front: str(p.target) || stripRuby(str(p.sentence_ruby)),
        reading: str(a.reading) || null,
        meaning: str(a.meaning),
      };
    case "grammar":
      return {
        front: str(p.pattern),
        reading: null,
        meaning: str(a.explanation),
      };
    case "particle": {
      const options = Array.isArray(p.options) ? (p.options as unknown[]) : [];
      const idx = typeof p.answer_index === "number" ? p.answer_index : -1;
      const correct = idx >= 0 && idx < options.length ? str(options[idx]) : "";
      return {
        front: correct,
        reading: null,
        meaning: str(a.explanation),
      };
    }
    case "conjugation":
      return {
        front: str(p.base) || stripRuby(str(p.base_ruby)),
        reading: str(a.expected) || null,
        meaning: str(p.tense),
      };
    case "reading":
      return {
        front: str(p.question_english),
        reading: null,
        meaning: str(a.answer_english),
      };
    default:
      return { front: "", reading: null, meaning: "" };
  }
}

// Leitner box (1..5) → mastery fraction (0..1). No review state → 0 (unseen).
export function boxToMastery(box: number | null | undefined): number {
  if (box == null || box < 1) return 0;
  return Math.min(box, 5) / 5;
}

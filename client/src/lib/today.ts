import type { Skill } from "@nihongo/shared";

// Today has two heroes: practice (review what's in the deck) and add (put new
// cards into it). Library's skill view hands off to one of them; `nonce` makes
// a second hand-off to the same section still scroll, and remounts the add
// form so its type and tag presets apply again.
export type TodaySection = "practice" | "add";
export type TodayTarget = { section: TodaySection; skill?: Skill; tag?: string; nonce: number };

// The skills Generate (in Library) can make. Kanji come from the seeded kanji
// dataset, not from the model, so they are absent here (and from GenerateForm).
export const GENERATABLE: readonly Skill[] = ["vocab", "grammar", "reading", "conjugation", "particle", "explain", "listening"];

export function canGenerate(skill: Skill): boolean {
  return GENERATABLE.includes(skill);
}

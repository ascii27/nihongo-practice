import type { Skill } from "@nihongo/shared";

// Today has two heroes: practice (review what's in the deck) and add (put new
// cards into it). Library's skill view hands off to one of them; `nonce` makes
// a second hand-off to the same section still scroll, and remounts the add
// form so its skill preset applies again.
export type TodaySection = "practice" | "add";
export type TodayTarget = { section: TodaySection; skill?: Skill; nonce: number };

export type AddTab = "word" | "generate";

// The skills Generate can make. Kanji come from the seeded kanji dataset, not
// from the model, so they are absent here (and from GenerateForm).
export const GENERATABLE: readonly Skill[] = ["vocab", "grammar", "reading", "conjugation", "particle", "explain", "listening"];

export function canGenerate(skill: Skill): boolean {
  return GENERATABLE.includes(skill);
}

const KEY = "nihongo.addTab";

// Remembered per device, like the practice hero's tab. Storage can be missing
// or throw, so the fallback is "Add a word" — the quicker of the two.
export function loadAddTab(): AddTab {
  try {
    return localStorage.getItem(KEY) === "generate" ? "generate" : "word";
  } catch {
    return "word";
  }
}

export function saveAddTab(t: AddTab): void {
  try { localStorage.setItem(KEY, t); } catch { /* storage unavailable */ }
}

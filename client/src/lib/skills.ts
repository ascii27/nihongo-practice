import type { Skill } from "@nihongo/shared";

export const SKILL_ORDER: Skill[] = ["vocab", "grammar", "particle", "conjugation", "reading"];

// Display metadata per skill. `ja` is a 2-kanji name; `short` is the single
// kanji used in the round glyph chips on Today / Browse.
export const SKILL_META: Record<Skill, { label: string; ja: string; short: string }> = {
  vocab: { label: "Vocab", ja: "語彙", short: "語" },
  grammar: { label: "Grammar", ja: "文法", short: "文" },
  particle: { label: "Particles", ja: "助詞", short: "助" },
  conjugation: { label: "Conjugation", ja: "活用", short: "活" },
  reading: { label: "Reading", ja: "読解", short: "読" },
};

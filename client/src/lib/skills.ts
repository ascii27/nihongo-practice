import type { Skill } from "@nihongo/shared";

export const SKILL_ORDER: Skill[] = ["vocab", "grammar", "particle", "conjugation", "reading", "explain", "listening"];

// Display metadata per skill. `ja` is a 2-kanji name; `short` is the single
// kanji used in the round glyph chips on Today / Browse.
export const SKILL_META: Record<Skill, { label: string; ja: string; short: string }> = {
  vocab: { label: "Vocab", ja: "語彙", short: "語" },
  grammar: { label: "Grammar", ja: "文法", short: "文" },
  particle: { label: "Particles", ja: "助詞", short: "助" },
  conjugation: { label: "Conjugation", ja: "活用", short: "活" },
  reading: { label: "Reading", ja: "読解", short: "読" },
  explain: { label: "Explain", ja: "説明", short: "説" },
  listening: { label: "Listening", ja: "聴解", short: "聴" },
};

// Static one-line intros for task skills, which have no generated teaching block.
export const TASK_INTRO: Partial<Record<Skill, string>> = {
  reading: "Read the short passage, then answer the comprehension question.",
  listening: "Listen to the audio, then answer the questions.",
  explain: "Write a short explanation in Japanese using the required connectives.",
};

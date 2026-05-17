export type CardInput = {
  external_id: string;
  japanese: string;
  english: string;
};

export type PromptPair = { system: string; user: string };

const VOCAB_SYSTEM = `You generate beginner-to-intermediate Japanese vocabulary cards. For each card, output one common word and one short natural example sentence (under 20 syllables) that uses it. Vary parts of speech (nouns, verbs, adjectives) across the batch unless the user's hint constrains otherwise.
Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "items": [ { "target": "<word>", "sentence_japanese": "<JA>", "sentence_english": "<EN>" } ] }`;

export function buildVocabPrompt(args: { count: number; weakness_hint?: string }): PromptPair {
  const lines: string[] = [`Generate ${args.count} vocabulary cards.`];
  if (args.weakness_hint && args.weakness_hint.trim().length > 0) {
    lines.push(`Focus on: ${args.weakness_hint.trim()}`);
  }
  return { system: VOCAB_SYSTEM, user: lines.join("\n") };
}

const SENTENCES_FOR_CARDS_SYSTEM = `You write a single natural everyday Japanese example sentence for each vocabulary word given.
The sentence MUST contain the target word verbatim. Keep it short (under 20 syllables) and use common modern Japanese.
Reply ONLY with valid JSON matching this exact schema:
{ "sentences": [ { "external_id": "<id>", "sentence_japanese": "<JA>", "sentence_english": "<EN>" } ] }
No commentary. No code fences.`;

export function buildSentencesForCardsPrompt(cards: CardInput[]): PromptPair {
  const user = [
    "Generate one example sentence per word:",
    ...cards.map((c) => `- id=${c.external_id}: ${c.japanese} (${c.english})`),
  ].join("\n");
  return { system: SENTENCES_FOR_CARDS_SYSTEM, user };
}

const GRAMMAR_SYSTEM = `You generate Japanese grammar drill cards for an intermediate learner. Each card shows a natural sentence built around a specific pattern. Vary patterns across the batch.
Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "items": [ { "pattern": "<pattern label, e.g. 〜ながら>", "sentence_japanese": "<JA>", "sentence_english": "<EN>", "explanation": "<1–2 sentence explanation>", "another_example_japanese": "<optional second example, JA>" } ] }`;

export function buildGrammarPrompt(args: { count: number; weakness_hint?: string }): PromptPair {
  const lines: string[] = [`Generate ${args.count} grammar drill cards.`];
  if (args.weakness_hint && args.weakness_hint.trim().length > 0) {
    lines.push(`Focus on: ${args.weakness_hint.trim()}`);
  }
  return { system: GRAMMAR_SYSTEM, user: lines.join("\n") };
}

const PARTICLE_SYSTEM = `You generate Japanese particle drill cards. Each card is a sentence with exactly one particle slot, marked by three underscores '___'. Provide four particle options (one correct, three plausible distractors). The correct option's position should vary across the batch.
Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "items": [ { "sentence_japanese_blanked": "<JA with ___>", "options": ["<p1>", "<p2>", "<p3>", "<p4>"], "answer_index": 0|1|2|3, "explanation": "<1 sentence>" } ] }`;

export function buildParticlePrompt(args: { count: number; weakness_hint?: string }): PromptPair {
  const lines: string[] = [`Generate ${args.count} particle drill cards.`];
  if (args.weakness_hint && args.weakness_hint.trim().length > 0) {
    lines.push(`Focus on: ${args.weakness_hint.trim()}`);
  }
  return { system: PARTICLE_SYSTEM, user: lines.join("\n") };
}

const CONJUGATION_SYSTEM = `You generate Japanese verb conjugation drills. For each item provide a base verb (dictionary form), the requested tense, the expected conjugated form, and optionally a list of common acceptable alternates. Mix verb classes (godan, ichidan, irregular) and tenses (te-form, past polite, past plain, negative polite, negative plain, potential, passive, causative, ば conditional, たら conditional, volitional) across the batch.
Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "items": [ { "base": "<dictionary form, e.g. 食べる>", "tense": "<English tense label>", "expected": "<expected conjugated form, kana or kanji+kana>", "alternates": ["<other accepted forms, optional>"] } ] }`;

export function buildConjugationPrompt(args: { count: number; weakness_hint?: string }): PromptPair {
  const lines: string[] = [`Generate ${args.count} verb conjugation drills.`];
  if (args.weakness_hint && args.weakness_hint.trim().length > 0) {
    lines.push(`Focus on: ${args.weakness_hint.trim()}`);
  }
  return { system: CONJUGATION_SYSTEM, user: lines.join("\n") };
}

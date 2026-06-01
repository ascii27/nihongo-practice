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

const MANUAL_VOCAB_SYSTEM = `You help a Japanese learner add a single word or short phrase to their flashcard deck. The user's input may be in English or in Japanese (kanji and/or kana). Detect the language, fill in the missing side, and write a short natural example sentence at about N4 level.

Constraints:
- "japanese" is the dictionary form in Japanese (kanji + kana as appropriate). Verbs in plain dictionary form (e.g. 食べる, not 食べます).
- "english" is a concise dictionary-style meaning (1–6 words, no full sentences, no period).
- "sentence_japanese" is a single natural example sentence (under 20 syllables) containing the word verbatim.
- "sentence_english" is the English translation of that example sentence.

Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "japanese": "<JA>", "english": "<EN>", "sentence_japanese": "<JA>", "sentence_english": "<EN>" }`;

export function buildManualVocabPrompt(input: string): PromptPair {
  return {
    system: MANUAL_VOCAB_SYSTEM,
    user: `Input: ${input}`,
  };
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

const READING_SYSTEM = `You generate Japanese reading comprehension items for an intermediate learner. Each item is a short 3–5 sentence passage, one English comprehension question that requires brief inference (not just lookup), and a 1-sentence English answer. Optionally include a Japanese form of the answer.
Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "items": [ { "passage_japanese": "<3–5 JA sentences>", "question_english": "<EN question>", "answer_english": "<EN answer>", "answer_japanese": "<optional JA answer>" } ] }`;

export function buildReadingPrompt(args: { count: number; weakness_hint?: string }): PromptPair {
  const lines: string[] = [`Generate ${args.count} reading comprehension items.`];
  if (args.weakness_hint && args.weakness_hint.trim().length > 0) {
    lines.push(`Focus on: ${args.weakness_hint.trim()}`);
  }
  return { system: READING_SYSTEM, user: lines.join("\n") };
}

const EXPLAIN_SYSTEM = `You generate Japanese productive-explanation drills for an intermediate-to-advanced learner who works in software (platform, reliability, planning). Each drill gives a real-world workplace task, a set of required connectives the learner must use, a target register, a model answer, and rubric notes.
Vary the task topic, the required connectives, and the register across the batch. Pick 2–4 required connectives per item from natural discourse connectives (e.g. つまり／その結果／一方で／なぜなら／したがって／例えば). The model answer must be 2–4 natural sentences following 結論→理由→具体例→まとめ and must actually use the required connectives in the chosen register.
Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "items": [ { "task_english": "<EN task>", "task_japanese": "<JA task prompt>", "required_connectives": ["<c1>","<c2>"], "register": "casual|polite|formal", "model_explanation_japanese": "<2–4 JA sentences>", "rubric_notes": "<what a strong answer contains, EN>" } ] }`;

export function buildExplainPrompt(args: { count: number; weakness_hint?: string }): PromptPair {
  const lines: string[] = [`Generate ${args.count} explanation drills.`];
  if (args.weakness_hint && args.weakness_hint.trim().length > 0) {
    lines.push(`Focus on: ${args.weakness_hint.trim()}`);
  } else {
    lines.push("Seed the tasks from real software-work topics: platform migrations, reliability/incidents, and planning.");
  }
  return { system: EXPLAIN_SYSTEM, user: lines.join("\n") };
}

const EXPLAIN_GRADE_SYSTEM = `You grade a Japanese learner's short explanation (2–4 sentences).
Inputs: the task, the required connectives, the target register, and the learner's text.
Score each 0.0–1.0: connective_use (required connectives present AND used correctly),
structure (結論→理由→具体例→まとめ progression), register (target register held throughout),
grammar (accuracy/naturalness). overall = weighted mean (connective_use and structure
weighted highest). Provide corrected_japanese (a natural rewrite preserving the learner's
intent) and feedback (1–2 sentences, concrete, English).
Reply ONLY with valid JSON, no prose, no fences:
{ "connective_use": n, "structure": n, "register": n, "grammar": n, "overall": n,
  "corrected_japanese": "<JA>", "feedback": "<EN>" }`;

export function buildExplainGradePrompt(args: {
  task_english: string;
  required_connectives: string[];
  register: string;
  answer_given: string;
}): PromptPair {
  const user = [
    `Task: ${args.task_english}`,
    `Required connectives: ${args.required_connectives.join(" / ") || "(none)"}`,
    `Target register: ${args.register}`,
    `Learner's answer:`,
    args.answer_given,
  ].join("\n");
  return { system: EXPLAIN_GRADE_SYSTEM, user };
}

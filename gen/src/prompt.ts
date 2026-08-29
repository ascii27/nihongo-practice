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

const MANUAL_GRAMMAR_SYSTEM = `You help a Japanese learner add a single grammar point to their study list. The user's input is a grammar pattern (often with a ～ placeholder, e.g. ～てから) or a short description of one. Identify the pattern, explain its usage, and write one natural example sentence that uses it, at about N4 level.

Constraints:
- "pattern" is the grammar point in Japanese, using ～ for slots where a word attaches (e.g. ～てから, ～なければならない).
- "explanation" is a concise English explanation of what the pattern means and when to use it (1–2 sentences, no fluff).
- "sentence_japanese" is a single natural example sentence (under 20 syllables) that clearly uses the pattern.
- "sentence_english" is the English translation of that example sentence.

Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "pattern": "<JA>", "explanation": "<EN>", "sentence_japanese": "<JA>", "sentence_english": "<EN>" }`;

export function buildManualGrammarPrompt(input: string): PromptPair {
  return {
    system: MANUAL_GRAMMAR_SYSTEM,
    user: `Input: ${input}`,
  };
}

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

export function buildExplainPrompt(args: { count: number; weakness_hint?: string; variety_note?: string }): PromptPair {
  const lines: string[] = [`Generate ${args.count} explanation drills.`];
  if (args.weakness_hint && args.weakness_hint.trim().length > 0) {
    lines.push(`Focus on: ${args.weakness_hint.trim()}`);
  } else {
    lines.push("Seed the tasks from real software-work topics: platform migrations, reliability/incidents, and planning.");
  }
  // When a request is split into parallel sub-batches (see generateExplainBatch),
  // each sub-batch gets this nudge so the concatenated set stays varied even
  // though the calls can't see each other.
  if (args.variety_note && args.variety_note.trim().length > 0) {
    lines.push(args.variety_note.trim());
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

const LISTENING_SYSTEM = `You generate Japanese listening-comprehension items for a learner at the given JLPT level. Each item is either a short monologue (~3–5 sentences) or a two-person dialogue (~4–8 turns) on one everyday or workplace topic, plus 2–4 English multiple-choice comprehension questions.
Rules:
- Keep vocabulary and grammar appropriate to the JLPT level.
- "segments" breaks the script into speech turns: speaker 0 and (for dialogue) speaker 1, in spoken order. For a monologue use a single speaker 0 segment or several speaker-0 segments.
- "transcript_japanese" is the full script as plain Japanese text (concatenate the segment texts).
- Each question has exactly four options and one correct answer_index (0–3). Vary the correct position across questions. Questions must require comprehension, not just word-spotting.
Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "items": [ { "audio_kind": "monologue|dialogue", "topic": "<short EN>", "jlpt_level": "<N5..N1>", "segments": [ { "text": "<JA>", "speaker": 0 } ], "transcript_japanese": "<JA>", "translation_english": "<EN>", "questions": [ { "question_english": "<EN>", "options": ["<a>","<b>","<c>","<d>"], "answer_index": 0, "explanation": "<1 sentence EN>" } ] } ] }`;

export function buildListeningPrompt(args: { count: number; weakness_hint?: string; jlpt_level?: string }): PromptPair {
  const lines: string[] = [`Generate ${args.count} listening-comprehension items at JLPT level ${args.jlpt_level ?? "N4"}.`];
  if (args.weakness_hint && args.weakness_hint.trim().length > 0) {
    lines.push(`Focus on: ${args.weakness_hint.trim()}`);
  }
  lines.push("Mix monologue and dialogue across the batch, and vary topics.");
  return { system: LISTENING_SYSTEM, user: lines.join("\n") };
}

const GRAMMAR_LESSON_SYSTEM = `You write a teaching block for a single Japanese grammar point, pitched at the learner's JLPT level. First a short example dialogue that shows the grammar in use, then an explanation of the point and its nuances.
Reply ONLY with valid JSON matching this exact schema, no prose, no fences:
{"dialog": [{"speaker": string, "jp": string, "en": string}], "explanation": string}

Rules:
- "dialog" is a short, natural example conversation of 4–6 lines between two speakers that shows the grammar point used in context. "speaker" is a short label such as "A" or "B" (keep it consistent). "jp" is the Japanese line (NO furigana markup); "en" is its English translation. At least two lines should use the grammar point.
- "explanation" is a clear English explanation (2–4 flowing sentences, NOT a numbered or step-by-step list) of what the grammar point means, how it is formed, and its key nuances or caveats.`;

export function buildGrammarLessonPrompt(args: {
  point: { title: string; meaning: string };
  jlpt_level: string;
}): PromptPair {
  const user = [
    `Grammar point: ${args.point.title}`,
    `Meaning: ${args.point.meaning}`,
    `Target JLPT level: ${args.jlpt_level}.`,
  ].join("\n");
  return { system: GRAMMAR_LESSON_SYSTEM, user };
}

const GRAMMAR_SELECTION_SYSTEM = `You are helping a Japanese learner pick grammar points for a themed lesson. From the numbered candidate grammar points, choose the 1–3 that best fit the learner's theme and level.
Reply ONLY with valid JSON matching this exact schema, no prose, no fences:
{"ids": string[]}
Use the exact "id" values given for the candidates you choose.`;

export function buildGrammarSelectionPrompt(args: {
  theme: string;
  jlpt_level: string;
  candidates: { id: string; title: string; meaning: string }[];
}): PromptPair {
  const lines = [
    `Theme: ${args.theme}`,
    `Target JLPT level: ${args.jlpt_level}`,
    `Candidates:`,
    ...args.candidates.map((c) => `- id=${c.id} | ${c.title} — ${c.meaning}`),
  ];
  return { system: GRAMMAR_SELECTION_SYSTEM, user: lines.join("\n") };
}

const LESSON_QUIZ_SYSTEM = `You write a short end-of-lesson quiz that tests a learner's understanding of one Japanese grammar point plus some target vocabulary. MIX the question formats across the batch.
Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "questions": [ { "question": "<EN question stem>", "sentence_japanese": "<optional JA sentence/context, may contain ___, else empty>", "options": ["<o1>", "<o2>", "<o3>", "<o4>"], "answer_index": 0|1|2|3, "explanation": "<1 sentence EN>" } ] }

Rules:
- Vary the format across the batch: some fill-in-the-blank (put a natural JA sentence containing '___' in "sentence_japanese" and ask which word/grammar fits), some meaning questions ("What does 〜X mean?"), some usage / "which sentence is correct?" questions.
- Always provide exactly four "options" and one correct "answer_index" (0–3); vary the correct position across the batch.
- Do NOT always make the target grammar the answer — mix in easier, lower-level grammar or vocabulary as correct answers and as distractors, so the learner must actually read each question.
- "sentence_japanese" has NO furigana markup; use an empty string when the question needs no Japanese sentence.`;

export function buildLessonQuizPrompt(args: {
  point: { title: string; meaning: string };
  vocab: string[];
  jlpt_level: string;
  count: number;
}): PromptPair {
  const lines = [
    `Generate ${args.count} quiz questions.`,
    `Grammar point being tested: ${args.point.title} (${args.point.meaning})`,
    `Target JLPT level: ${args.jlpt_level}.`,
    `Also test these target vocabulary words: ${args.vocab.join("、")}`,
  ];
  return { system: LESSON_QUIZ_SYSTEM, user: lines.join("\n") };
}

const KANJI_MNEMONIC_SYSTEM = `You write vivid memory aids for a Japanese learner studying kanji, in the spirit of WaniKani: funny, visual, slightly absurd, and easy to replay in the head.

For the MEANING:
- Lead with the kanji's most useful everyday meaning.
- Break the kanji into recognizable visual components and stage one short concrete scene that connects those shapes to the meaning. Prefer concrete images and actions over abstract explanation.
- The component breakdown is a memory aid ONLY. Never present it as the historical etymology of the kanji.
- Give a compressed "hook" line the learner can replay, e.g. "messy bundle -> make it correct -> ORGANIZE".

For each READING:
- Pick the main on'yomi plus the 1 to 3 kun'yomi a learner is actually likely to meet. NEVER list rare readings. At most 4 readings in total.
- Give an English sound hook that resembles the Japanese sound (ユウ -> YOU, セイ -> SAY, ととのえる -> TOTAL NO, おりる -> OH, REAR). It does not need to be phonetically perfect; memorable beats accurate.
- Write a short scene, with emotion and a strong action, connecting that sound hook to the meaning.
- Write ONE natural everyday Japanese sentence (under 20 syllables) that contains the kanji AND uses that specific reading, plus its English translation.
- When a kanji has several related kun'yomi, add a "note" making the difference easy to remember in plain English before grammar terminology, e.g. "整える = you arrange something / 整う = something becomes arranged". Omit "note" otherwise.

Finish with a very short recap: one line per reading, like "セイ -> SAY it looks good".

Favor absurd imagery, strong actions, emotion, familiar English words, and one clear mental image. Avoid long explanations, obscure vocabulary, academic radical analysis, and weak sound associations where a fun approximation is possible.

Reply ONLY with valid JSON in this exact shape, no prose, no fences:
{ "meaning": { "gloss": "<short English gloss>", "scene": "<the visual scene>", "hook": "<compressed replay line>" },
  "readings": [ { "type": "on" | "kun", "reading": "<JA reading>", "sound_hook": "<ENGLISH SOUND>", "scene": "<mini story>", "sentence_japanese": "<JA>", "sentence_english": "<EN>", "note": "<optional>" } ],
  "recap": [ "<one line per reading>" ] }`;

export function buildKanjiMnemonicPrompt(args: {
  character: string;
  meanings: string[];
  on: string[];
  kun: string[];
}): PromptPair {
  const list = (xs: string[]) => (xs.length ? xs.join("、") : "none");
  const user = [
    `Write a mnemonic for the kanji ${args.character}.`,
    `Dictionary meanings: ${args.meanings.length ? args.meanings.join(", ") : "unknown"}`,
    `Known on'yomi: ${list(args.on)}`,
    `Known kun'yomi: ${list(args.kun)}`,
    `Choose the main on'yomi and only the kun'yomi a learner will actually encounter. At most 4 readings total.`,
  ].join("\n");
  return { system: KANJI_MNEMONIC_SYSTEM, user };
}

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

export type VocabItem = {
  target: string;
  sentence_japanese: string;
  sentence_english: string;
};

export type SentenceForCard = {
  external_id: string;
  sentence_japanese: string;
  sentence_english: string;
};

// A user-supplied vocab entry, after the AI fills in the missing side plus an
// example sentence. Unlike the batch generators this returns a single object,
// not a wrapping `items` array.
export type ManualVocabItem = {
  japanese: string;
  english: string;
  sentence_japanese: string;
  sentence_english: string;
};

export function parseManualVocab(raw: string): ManualVocabItem {
  const parsed = JSON.parse(stripFences(raw));
  if (
    typeof parsed?.japanese !== "string" ||
    typeof parsed?.english !== "string" ||
    typeof parsed?.sentence_japanese !== "string" ||
    typeof parsed?.sentence_english !== "string"
  ) {
    throw new Error("manual vocab response missing required fields");
  }
  return {
    japanese: parsed.japanese,
    english: parsed.english,
    sentence_japanese: parsed.sentence_japanese,
    sentence_english: parsed.sentence_english,
  };
}

// Manual grammar entry: the learner types a grammar pattern (or a description)
// and the model returns the pattern plus an English explanation and one example
// sentence. Single object, like manual vocab.
export type ManualGrammarItem = {
  pattern: string;
  explanation: string;
  sentence_japanese: string;
  sentence_english: string;
};

export function parseManualGrammar(raw: string): ManualGrammarItem {
  const parsed = JSON.parse(stripFences(raw));
  if (
    typeof parsed?.pattern !== "string" ||
    typeof parsed?.explanation !== "string" ||
    typeof parsed?.sentence_japanese !== "string" ||
    typeof parsed?.sentence_english !== "string"
  ) {
    throw new Error("manual grammar response missing required fields");
  }
  return {
    pattern: parsed.pattern,
    explanation: parsed.explanation,
    sentence_japanese: parsed.sentence_japanese,
    sentence_english: parsed.sentence_english,
  };
}

// The model's wire shape for a kanji mnemonic. Sentences are flat here; the
// server nests them and adds furigana before storing.
export type KanjiMnemonicReadingRaw = {
  type: "on" | "kun";
  reading: string;
  sound_hook: string;
  scene: string;
  sentence_japanese: string;
  sentence_english: string;
  note?: string;
};

export type KanjiMnemonicRaw = {
  meaning: { gloss: string; scene: string; hook: string };
  readings: KanjiMnemonicReadingRaw[];
  recap: string[];
};

const MAX_READINGS = 4;

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function parseKanjiMnemonic(raw: string): KanjiMnemonicRaw {
  const parsed = JSON.parse(stripFences(raw));
  const m = parsed?.meaning;
  if (!nonEmpty(m?.gloss) || !nonEmpty(m?.scene) || !nonEmpty(m?.hook)) {
    throw new Error("kanji mnemonic response missing meaning fields");
  }
  if (!Array.isArray(parsed?.readings) || parsed.readings.length === 0) {
    throw new Error("kanji mnemonic response has no readings");
  }
  // Over-long lists are trimmed rather than rejected: five good readings is a
  // usable answer, just more than a card should show.
  const readings: KanjiMnemonicReadingRaw[] = parsed.readings
    .slice(0, MAX_READINGS)
    .map((r: Record<string, unknown>) => {
      if (
        (r?.type !== "on" && r?.type !== "kun") ||
        !nonEmpty(r?.reading) || !nonEmpty(r?.sound_hook) || !nonEmpty(r?.scene) ||
        !nonEmpty(r?.sentence_japanese) || !nonEmpty(r?.sentence_english)
      ) {
        throw new Error("kanji mnemonic reading missing required fields");
      }
      return {
        type: r.type,
        reading: r.reading as string,
        sound_hook: r.sound_hook as string,
        scene: r.scene as string,
        sentence_japanese: r.sentence_japanese as string,
        sentence_english: r.sentence_english as string,
        ...(nonEmpty(r?.note) ? { note: r.note as string } : {}),
      };
    });
  // recap restates what the readings already carry, so a model that skips it
  // has not failed.
  const recap = Array.isArray(parsed?.recap)
    ? parsed.recap.filter(nonEmpty).slice(0, 5)
    : [];
  return { meaning: { gloss: m.gloss, scene: m.scene, hook: m.hook }, readings, recap };
}

export function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced?.[1]?.trim() ?? trimmed;
}

export function parseVocabBatch(raw: string): VocabItem[] {
  const parsed = JSON.parse(stripFences(raw));
  const items = parsed?.items;
  if (!Array.isArray(items)) throw new Error("response missing 'items' array");
  for (const it of items) {
    if (
      typeof it?.target !== "string" ||
      typeof it?.sentence_japanese !== "string" ||
      typeof it?.sentence_english !== "string"
    ) {
      throw new Error("response item missing required fields");
    }
  }
  return items as VocabItem[];
}

export type GrammarItem = {
  pattern: string;
  sentence_japanese: string;
  sentence_english: string;
  explanation: string;
  another_example_japanese?: string;
};

export function parseGrammarBatch(raw: string): GrammarItem[] {
  const parsed = JSON.parse(stripFences(raw));
  const items = parsed?.items;
  if (!Array.isArray(items)) throw new Error("response missing 'items' array");
  for (const it of items) {
    if (
      typeof it?.pattern !== "string" ||
      typeof it?.sentence_japanese !== "string" ||
      typeof it?.sentence_english !== "string" ||
      typeof it?.explanation !== "string"
    ) {
      throw new Error("grammar item missing required fields");
    }
    if (it.another_example_japanese !== undefined && typeof it.another_example_japanese !== "string") {
      throw new Error("grammar item has non-string another_example_japanese");
    }
  }
  return items as GrammarItem[];
}

export type ParticleItem = {
  sentence_japanese_blanked: string;
  options: string[];
  answer_index: number;
  explanation: string;
};

export function parseParticleBatch(raw: string): ParticleItem[] {
  const parsed = JSON.parse(stripFences(raw));
  const items = parsed?.items;
  if (!Array.isArray(items)) throw new Error("response missing 'items' array");
  for (const it of items) {
    if (
      typeof it?.sentence_japanese_blanked !== "string" ||
      !Array.isArray(it?.options) ||
      it.options.length !== 4 ||
      it.options.some((o: unknown) => typeof o !== "string") ||
      typeof it?.answer_index !== "number" ||
      it.answer_index < 0 || it.answer_index > 3 ||
      !Number.isInteger(it.answer_index) ||
      typeof it?.explanation !== "string"
    ) {
      throw new Error("particle item missing or invalid required fields");
    }
  }
  return items as ParticleItem[];
}

export type ConjugationItem = {
  base: string;
  tense: string;
  expected: string;
  alternates?: string[];
};

export function parseConjugationBatch(raw: string): ConjugationItem[] {
  const parsed = JSON.parse(stripFences(raw));
  const items = parsed?.items;
  if (!Array.isArray(items)) throw new Error("response missing 'items' array");
  for (const it of items) {
    if (
      typeof it?.base !== "string" ||
      typeof it?.tense !== "string" ||
      typeof it?.expected !== "string"
    ) {
      throw new Error("conjugation item missing required fields");
    }
    if (it.alternates !== undefined) {
      if (!Array.isArray(it.alternates) || it.alternates.some((a: unknown) => typeof a !== "string")) {
        throw new Error("conjugation item has invalid alternates");
      }
    }
  }
  return items as ConjugationItem[];
}

export type ReadingItem = {
  passage_japanese: string;
  question_english: string;
  answer_english: string;
  answer_japanese?: string;
};

export function parseReadingBatch(raw: string): ReadingItem[] {
  const parsed = JSON.parse(stripFences(raw));
  const items = parsed?.items;
  if (!Array.isArray(items)) throw new Error("response missing 'items' array");
  for (const it of items) {
    if (
      typeof it?.passage_japanese !== "string" ||
      typeof it?.question_english !== "string" ||
      typeof it?.answer_english !== "string"
    ) {
      throw new Error("reading item missing required fields");
    }
    if (it.answer_japanese !== undefined && typeof it.answer_japanese !== "string") {
      throw new Error("reading item has non-string answer_japanese");
    }
  }
  return items as ReadingItem[];
}

export type ExplainItem = {
  task_english: string;
  task_japanese: string;
  required_connectives: string[];
  register: "casual" | "polite" | "formal";
  model_explanation_japanese: string;
  rubric_notes: string;
};

const REGISTERS = ["casual", "polite", "formal"] as const;

export function parseExplainBatch(raw: string): ExplainItem[] {
  const parsed = JSON.parse(stripFences(raw));
  const items = parsed?.items;
  if (!Array.isArray(items)) throw new Error("response missing 'items' array");
  for (const it of items) {
    if (
      typeof it?.task_english !== "string" ||
      typeof it?.task_japanese !== "string" ||
      !Array.isArray(it?.required_connectives) ||
      it.required_connectives.some((c: unknown) => typeof c !== "string") ||
      typeof it?.register !== "string" ||
      !REGISTERS.includes(it.register) ||
      typeof it?.model_explanation_japanese !== "string" ||
      typeof it?.rubric_notes !== "string"
    ) {
      throw new Error("explain item missing or invalid required fields");
    }
  }
  return items as ExplainItem[];
}

export type ExplainGradeRaw = {
  connective_use: number;
  structure: number;
  register: number;
  grammar: number;
  overall: number;
  corrected_japanese: string;
  feedback: string;
};

function clamp01(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) throw new Error("score is not a number");
  return Math.max(0, Math.min(1, n));
}

export function parseExplainGrade(raw: string): ExplainGradeRaw {
  const p = JSON.parse(stripFences(raw));
  if (typeof p?.corrected_japanese !== "string" || typeof p?.feedback !== "string") {
    throw new Error("explain grade missing corrected_japanese/feedback");
  }
  return {
    connective_use: clamp01(p.connective_use),
    structure: clamp01(p.structure),
    register: clamp01(p.register),
    grammar: clamp01(p.grammar),
    overall: clamp01(p.overall),
    corrected_japanese: p.corrected_japanese,
    feedback: p.feedback,
  };
}

export type ListeningGenItem = {
  audio_kind: "monologue" | "dialogue";
  topic: string;
  jlpt_level: string;
  segments: { text: string; speaker: 0 | 1 }[];
  transcript_japanese: string;
  translation_english: string;
  questions: { question_english: string; options: string[]; answer_index: number; explanation?: string }[];
};

export function parseListeningBatch(raw: string): ListeningGenItem[] {
  const parsed = JSON.parse(stripFences(raw));
  const items = parsed?.items;
  if (!Array.isArray(items)) throw new Error("response missing 'items' array");
  for (const it of items) {
    if (
      (it?.audio_kind !== "monologue" && it?.audio_kind !== "dialogue") ||
      typeof it?.topic !== "string" ||
      typeof it?.jlpt_level !== "string" ||
      typeof it?.transcript_japanese !== "string" ||
      typeof it?.translation_english !== "string" ||
      !Array.isArray(it?.segments) || it.segments.length === 0 ||
      !Array.isArray(it?.questions) || it.questions.length < 1 || it.questions.length > 4
    ) {
      throw new Error("listening item missing or invalid required fields");
    }
    for (const s of it.segments) {
      if (typeof s?.text !== "string" || (s?.speaker !== 0 && s?.speaker !== 1)) {
        throw new Error("listening item has invalid segment");
      }
    }
    for (const q of it.questions) {
      if (
        typeof q?.question_english !== "string" ||
        !Array.isArray(q?.options) || q.options.length !== 4 ||
        q.options.some((o: unknown) => typeof o !== "string") ||
        typeof q?.answer_index !== "number" || !Number.isInteger(q.answer_index) ||
        q.answer_index < 0 || q.answer_index > 3
      ) {
        throw new Error("listening item has invalid question");
      }
    }
  }
  return items as ListeningGenItem[];
}

export type GrammarLesson = {
  dialog: { speaker: string; jp: string; en: string }[];
  explanation: string;
};

// A single end-of-lesson quiz question (mixed formats). Raw from the model —
// `sentence_japanese` is enriched to ruby by the server.
export type QuizQuestionRaw = {
  question: string;
  sentence_japanese?: string;
  options: string[];
  answer_index: number;
  explanation: string;
};

export function parseLessonQuiz(raw: string): QuizQuestionRaw[] {
  const parsed = JSON.parse(stripFences(raw));
  const questions = parsed?.questions;
  if (!Array.isArray(questions)) throw new Error("quiz missing 'questions' array");
  for (const q of questions) {
    if (
      typeof q?.question !== "string" ||
      !Array.isArray(q?.options) ||
      q.options.length !== 4 ||
      q.options.some((o: unknown) => typeof o !== "string") ||
      typeof q?.answer_index !== "number" ||
      !Number.isInteger(q.answer_index) ||
      q.answer_index < 0 || q.answer_index > 3 ||
      typeof q?.explanation !== "string"
    ) {
      throw new Error("quiz question missing or invalid required fields");
    }
    if (q.sentence_japanese !== undefined && typeof q.sentence_japanese !== "string") {
      throw new Error("quiz question has invalid 'sentence_japanese'");
    }
  }
  return questions as QuizQuestionRaw[];
}

export function parseGrammarLesson(raw: string): GrammarLesson {
  const parsed = JSON.parse(stripFences(raw));
  if (!Array.isArray(parsed?.dialog) || parsed.dialog.length === 0) {
    throw new Error("grammar lesson 'dialog' must be a non-empty array");
  }
  for (const line of parsed.dialog) {
    if (typeof line?.speaker !== "string" || typeof line?.jp !== "string" || typeof line?.en !== "string") {
      throw new Error("grammar lesson dialog line missing 'speaker'/'jp'/'en'");
    }
  }
  if (typeof parsed?.explanation !== "string" || parsed.explanation.trim() === "") {
    throw new Error("grammar lesson 'explanation' must be a non-empty string");
  }
  return parsed as GrammarLesson;
}

export type GrammarSelection = {
  ids: string[];
};

export function parseGrammarSelection(raw: string): GrammarSelection {
  const parsed = JSON.parse(stripFences(raw));
  if (!Array.isArray(parsed?.ids) || parsed.ids.some((id: unknown) => typeof id !== "string")) {
    throw new Error("grammar selection 'ids' must be a string array");
  }
  return { ids: parsed.ids as string[] };
}

export function parseSentencesForCards(raw: string): SentenceForCard[] {
  const parsed = JSON.parse(stripFences(raw));
  const sentences = parsed?.sentences;
  if (!Array.isArray(sentences)) throw new Error("response missing 'sentences' array");
  for (const s of sentences) {
    if (
      typeof s?.external_id !== "string" ||
      typeof s?.sentence_japanese !== "string" ||
      typeof s?.sentence_english !== "string"
    ) {
      throw new Error("response entry missing required fields");
    }
  }
  return sentences as SentenceForCard[];
}

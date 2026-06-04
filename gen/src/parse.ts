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

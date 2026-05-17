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

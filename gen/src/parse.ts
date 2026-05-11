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
  return fenced ? fenced[1].trim() : trimmed;
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

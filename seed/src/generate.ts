import Anthropic from "@anthropic-ai/sdk";
import type { CardInput } from "./parse-xml.js";

export type SentenceOutput = {
  external_id: string;
  sentence_japanese: string;
  sentence_english: string;
};

export type BatchResult = {
  sentences: SentenceOutput[];
  cost_usd: number;
};

export const MODEL = "claude-sonnet-4-6";
const MAX_RETRIES = 2;

// Pricing per 1M tokens (sonnet 4.6, USD).
const INPUT_PER_MTOK = 3.0;
const OUTPUT_PER_MTOK = 15.0;

const SYSTEM_PROMPT = `You write a single natural everyday Japanese example sentence for each vocabulary word given.
The sentence MUST contain the target word verbatim. Keep it short (under 20 syllables) and use common modern Japanese.
Reply ONLY with valid JSON matching this exact schema:
{ "sentences": [ { "external_id": "<id>", "sentence_japanese": "<JA>", "sentence_english": "<EN>" } ] }
No commentary. No code fences.`;

function buildUserPrompt(cards: CardInput[]): string {
  return [
    "Generate one example sentence per word:",
    ...cards.map((c) => `- id=${c.external_id}: ${c.japanese} (${c.english})`),
  ].join("\n");
}

export function parseBatchResponse(raw: string): SentenceOutput[] {
  const parsed = JSON.parse(raw);
  const sentences = parsed?.sentences;
  if (!Array.isArray(sentences)) throw new Error("response missing 'sentences' array");
  for (const s of sentences) {
    if (typeof s?.external_id !== "string"
      || typeof s?.sentence_japanese !== "string"
      || typeof s?.sentence_english !== "string") {
      throw new Error("response entry missing required fields");
    }
  }
  return sentences as SentenceOutput[];
}

export async function generateBatch(
  cards: CardInput[],
  opts: { client?: Anthropic } = {},
): Promise<BatchResult> {
  const client = opts.client ?? new Anthropic();

  let lastErr: unknown;
  let totalInput = 0;
  let totalOutput = 0;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(cards) }],
      });
      totalInput += resp.usage.input_tokens;
      totalOutput += resp.usage.output_tokens;
      const text = resp.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("");
      const sentences = parseBatchResponse(text);
      return {
        sentences,
        cost_usd: (totalInput / 1_000_000) * INPUT_PER_MTOK + (totalOutput / 1_000_000) * OUTPUT_PER_MTOK,
      };
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("generateBatch failed");
}

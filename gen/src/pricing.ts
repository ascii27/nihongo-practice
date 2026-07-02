export const MODEL = "claude-sonnet-4-6";

// Pricing per 1M tokens (sonnet 4.6, USD).
export const INPUT_PER_MTOK = 3.0;
export const OUTPUT_PER_MTOK = 15.0;

export type Usage = { input_tokens: number; output_tokens: number };

export function computeCost(usage: Usage): number {
  return (usage.input_tokens / 1_000_000) * INPUT_PER_MTOK
       + (usage.output_tokens / 1_000_000) * OUTPUT_PER_MTOK;
}

// OpenAI gpt-4o-mini-tts. Char-based estimate (verify against live billing and
// tune). ~$15 / 1M characters ⇒ $0.015 / 1k chars.
export const TTS_MODEL = "gpt-4o-mini-tts";
export const TTS_USD_PER_1K_CHARS = 0.015;

export function computeTtsCost(chars: number): number {
  return (chars / 1000) * TTS_USD_PER_1K_CHARS;
}

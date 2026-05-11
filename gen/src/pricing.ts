export const MODEL = "claude-sonnet-4-6";

// Pricing per 1M tokens (sonnet 4.6, USD).
export const INPUT_PER_MTOK = 3.0;
export const OUTPUT_PER_MTOK = 15.0;

export type Usage = { input_tokens: number; output_tokens: number };

export function computeCost(usage: Usage): number {
  return (usage.input_tokens / 1_000_000) * INPUT_PER_MTOK
       + (usage.output_tokens / 1_000_000) * OUTPUT_PER_MTOK;
}

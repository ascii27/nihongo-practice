import { describe, it, expect } from "vitest";
import { computeCost, MODEL, INPUT_PER_MTOK, OUTPUT_PER_MTOK } from "./pricing.js";

describe("pricing", () => {
  it("exports the sonnet model id and per-MTok rates", () => {
    expect(MODEL).toMatch(/sonnet/);
    expect(INPUT_PER_MTOK).toBe(3.0);
    expect(OUTPUT_PER_MTOK).toBe(15.0);
  });

  it("computes cost from usage", () => {
    // 1000 input * $3/1M + 500 output * $15/1M = 0.003 + 0.0075 = 0.0105
    expect(computeCost({ input_tokens: 1000, output_tokens: 500 })).toBeCloseTo(0.0105, 6);
  });

  it("returns 0 for zero usage", () => {
    expect(computeCost({ input_tokens: 0, output_tokens: 0 })).toBe(0);
  });
});

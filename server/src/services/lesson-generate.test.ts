import { describe, it, expect } from "vitest";
import { SECTION_COUNTS, buildWeaknessHint } from "./lesson-generate.js";

describe("lesson-generate helpers", () => {
  it("has a positive count for every skill", () => {
    for (const skill of ["vocab", "grammar", "reading", "conjugation", "particle", "explain", "listening"] as const) {
      expect(SECTION_COUNTS[skill]).toBeGreaterThan(0);
    }
  });
  it("weakness hint embeds topic and level", () => {
    const h = buildWeaknessHint("giving directions", "N4");
    expect(h).toContain("giving directions");
    expect(h).toContain("N4");
  });
});

import { describe, it, expect } from "vitest";
import { titleFor } from "./lessons.js";

describe("titleFor", () => {
  it("uses the trimmed topic as the title", () => {
    expect(titleFor("  Keigo basics  ")).toBe("Keigo basics");
  });
  it("caps very long topics", () => {
    expect(titleFor("x".repeat(200)).length).toBeLessThanOrEqual(120);
  });
});

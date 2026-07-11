import { describe, it, expect } from "vitest";
import { titleFrom } from "./lessons.js";
import type { GrammarPoint } from "@nihongo/shared";

const gp = (title: string): GrammarPoint => ({
  id: "11111111-1111-1111-1111-111111111111",
  jlpt_level: "N4", sort_order: 1, title, romaji: null, meaning: "m", slug: "n4-1",
});

describe("titleFrom", () => {
  it("uses the trimmed theme for an auto lesson", () => {
    expect(titleFrom({ mode: "auto", theme: "  giving advice  ", jlpt_level: "N4" }, [])).toBe("giving advice");
  });
  it("caps a very long theme", () => {
    expect(titleFrom({ mode: "auto", theme: "x".repeat(200), jlpt_level: "N4" }, []).length).toBeLessThanOrEqual(120);
  });
  it("joins grammar point titles for a manual lesson", () => {
    const t = titleFrom(
      { mode: "manual", grammar_point_ids: ["11111111-1111-1111-1111-111111111111"], jlpt_level: "N4" },
      [gp("〜てもいい"), gp("〜てはいけない")],
    );
    expect(t).toBe("〜てもいい、〜てはいけない");
  });
});

import { describe, it, expect } from "vitest";
import { toRubyHtml, readingFor } from "./furigana.js";

describe("toRubyHtml", () => {
  it("wraps kanji surface forms in <ruby>", async () => {
    const html = await toRubyHtml("本を読みます。");
    expect(html).toContain("<ruby>本<rt>");
    expect(html).toContain("<ruby>読み<rt>");
  });

  it("does not wrap kana-only segments", async () => {
    const html = await toRubyHtml("ありがとう");
    expect(html).not.toContain("<ruby>");
    expect(html).toContain("ありがとう");
  });
});

describe("readingFor", () => {
  it("returns the hiragana reading of a kanji term", async () => {
    const r = await readingFor("水");
    expect(r).toBe("みず");
  });

  it("returns the input itself for a kana-only term", async () => {
    const r = await readingFor("ありがとう");
    expect(r).toBe("ありがとう");
  });
});

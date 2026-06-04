import { describe, it, expect } from "vitest";
import { itemDisplay, boxToMastery } from "./item-display.js";

describe("itemDisplay", () => {
  it("vocab: target + reading + meaning", () => {
    expect(
      itemDisplay(
        "vocab",
        { sentence_ruby: "…", target: "友達", sentence_english: "with my friend" },
        { reading: "ともだち", meaning: "friend", notes: "x" },
      ),
    ).toEqual({ front: "友達", reading: "ともだち", meaning: "friend" });
  });

  it("grammar: pattern as front, explanation as meaning, no reading", () => {
    const d = itemDisplay(
      "grammar",
      { sentence_ruby: "…", pattern: "～たことがある", sentence_english: "x" },
      { explanation: "expresses past experience" },
    );
    expect(d.front).toBe("～たことがある");
    expect(d.reading).toBeNull();
    expect(d.meaning).toBe("expresses past experience");
  });

  it("particle: resolves the correct option via answer_index", () => {
    const d = itemDisplay(
      "particle",
      { sentence_ruby_blanked: "駅＿で", options: ["に", "で", "へ", "を"], answer_index: 1 },
      { explanation: "で marks the location of an action" },
    );
    expect(d.front).toBe("で");
    expect(d.meaning).toContain("location");
  });

  it("conjugation: base as front, tense as meaning, expected as reading", () => {
    const d = itemDisplay(
      "conjugation",
      { base: "食べる", base_ruby: "…", tense: "past polite" },
      { expected: "食べました", expected_ruby: "…" },
    );
    expect(d.front).toBe("食べる");
    expect(d.reading).toBe("食べました");
    expect(d.meaning).toBe("past polite");
  });

  it("reading: question + english answer", () => {
    const d = itemDisplay(
      "reading",
      { passage_ruby: "…", question_english: "How does he get there?" },
      { answer_english: "He walks." },
    );
    expect(d.front).toBe("How does he get there?");
    expect(d.meaning).toBe("He walks.");
  });

  it("explain: ruby-stripped task as front, english task as meaning", () => {
    const d = itemDisplay(
      "explain",
      {
        task_english: "Explain why you migrated to TiDB.",
        task_japanese_ruby: "<ruby>移行<rt>いこう</rt></ruby>した<ruby>理由<rt>りゆう</rt></ruby>",
        required_connectives: ["つまり"],
        register: "polite",
      },
      { model_explanation_ruby: "…", rubric_notes: "x" },
    );
    expect(d.front).toBe("移行した理由");
    expect(d.reading).toBeNull();
    expect(d.meaning).toBe("Explain why you migrated to TiDB.");
  });

  it("explain: falls back to english task when no japanese ruby", () => {
    const d = itemDisplay(
      "explain",
      { task_english: "Explain the incident.", required_connectives: [], register: "formal" },
      { model_explanation_ruby: "…", rubric_notes: "x" },
    );
    expect(d.front).toBe("Explain the incident.");
  });

  it("falls back to ruby-stripped text when a plain field is absent", () => {
    const d = itemDisplay(
      "conjugation",
      { base_ruby: "<ruby>飲<rt>の</rt></ruby>む", tense: "て-form" },
      { expected: "飲んで" },
    );
    expect(d.front).toBe("飲む");
  });

  it("tolerates missing fields", () => {
    expect(itemDisplay("vocab", null, undefined)).toEqual({ front: "", reading: null, meaning: "" });
  });
});

describe("boxToMastery", () => {
  it("maps boxes 1..5 to 0.2..1.0", () => {
    expect(boxToMastery(1)).toBeCloseTo(0.2);
    expect(boxToMastery(3)).toBeCloseTo(0.6);
    expect(boxToMastery(5)).toBeCloseTo(1.0);
  });
  it("clamps and treats unseen as 0", () => {
    expect(boxToMastery(null)).toBe(0);
    expect(boxToMastery(0)).toBe(0);
    expect(boxToMastery(9)).toBe(1);
  });
});

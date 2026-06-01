import { describe, it, expect } from "vitest";
import { parseVocabBatch, parseSentencesForCards, stripFences, parseGrammarBatch, parseParticleBatch, parseConjugationBatch, parseReadingBatch, parseManualVocab, parseExplainBatch, parseExplainGrade } from "./parse.js";

describe("stripFences", () => {
  it("strips ```json fences", () => {
    expect(stripFences("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
  });
  it("strips bare ``` fences", () => {
    expect(stripFences("```\n{\"a\":1}\n```")).toBe('{"a":1}');
  });
  it("returns trimmed input when no fences", () => {
    expect(stripFences("  {\"a\":1}  ")).toBe('{"a":1}');
  });
});

describe("parseVocabBatch", () => {
  it("returns items with target/sentence_japanese/sentence_english", () => {
    const raw = JSON.stringify({
      items: [
        { target: "本", sentence_japanese: "私は本を読みます。", sentence_english: "I read a book." },
        { target: "水", sentence_japanese: "水を飲みます。", sentence_english: "I drink water." },
      ],
    });
    expect(parseVocabBatch(raw)).toEqual([
      { target: "本", sentence_japanese: "私は本を読みます。", sentence_english: "I read a book." },
      { target: "水", sentence_japanese: "水を飲みます。", sentence_english: "I drink water." },
    ]);
  });

  it("strips ```json code fences before parsing", () => {
    const inner = JSON.stringify({
      items: [{ target: "本", sentence_japanese: "本。", sentence_english: "A book." }],
    });
    expect(parseVocabBatch("```json\n" + inner + "\n```")).toHaveLength(1);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseVocabBatch("not json")).toThrow();
  });

  it("throws when entries are missing required fields", () => {
    expect(() => parseVocabBatch(JSON.stringify({ items: [{ target: "本" }] }))).toThrow();
  });

  it("throws when items is not an array", () => {
    expect(() => parseVocabBatch(JSON.stringify({ items: "nope" }))).toThrow();
  });
});

describe("parseSentencesForCards", () => {
  it("returns sentences keyed by external_id", () => {
    const raw = JSON.stringify({
      sentences: [
        { external_id: "a", sentence_japanese: "本。", sentence_english: "A book." },
      ],
    });
    expect(parseSentencesForCards(raw)).toEqual([
      { external_id: "a", sentence_japanese: "本。", sentence_english: "A book." },
    ]);
  });

  it("throws on malformed entries", () => {
    expect(() => parseSentencesForCards(JSON.stringify({ sentences: [{ external_id: "a" }] }))).toThrow();
  });

  it("strips code fences", () => {
    const inner = JSON.stringify({
      sentences: [{ external_id: "a", sentence_japanese: "本。", sentence_english: "A book." }],
    });
    expect(parseSentencesForCards("```json\n" + inner + "\n```")).toHaveLength(1);
  });
});

describe("parseGrammarBatch", () => {
  it("returns items with pattern/sentence_japanese/sentence_english/explanation", () => {
    const raw = JSON.stringify({
      items: [
        {
          pattern: "〜ながら",
          sentence_japanese: "音楽を聞きながら勉強します。",
          sentence_english: "I study while listening to music.",
          explanation: "〜ながら attaches to the masu-stem and means 'while doing X'.",
        },
      ],
    });
    expect(parseGrammarBatch(raw)).toEqual([
      {
        pattern: "〜ながら",
        sentence_japanese: "音楽を聞きながら勉強します。",
        sentence_english: "I study while listening to music.",
        explanation: "〜ながら attaches to the masu-stem and means 'while doing X'.",
      },
    ]);
  });

  it("accepts an optional another_example_japanese field", () => {
    const raw = JSON.stringify({
      items: [
        {
          pattern: "〜ながら",
          sentence_japanese: "歩きながら話す。",
          sentence_english: "Talk while walking.",
          explanation: "...",
          another_example_japanese: "食べながら見る。",
        },
      ],
    });
    const out = parseGrammarBatch(raw);
    expect(out[0]!.another_example_japanese).toBe("食べながら見る。");
  });

  it("throws when a required field is missing", () => {
    expect(() => parseGrammarBatch(JSON.stringify({
      items: [{ pattern: "x", sentence_japanese: "y" }],
    }))).toThrow();
  });

  it("throws when items is not an array", () => {
    expect(() => parseGrammarBatch(JSON.stringify({ items: "x" }))).toThrow();
  });

  it("strips ```json fences", () => {
    const inner = JSON.stringify({
      items: [{ pattern: "x", sentence_japanese: "y", sentence_english: "z", explanation: "w" }],
    });
    expect(parseGrammarBatch("```json\n" + inner + "\n```")).toHaveLength(1);
  });
});

describe("parseConjugationBatch", () => {
  it("returns items with base/tense/expected (+ optional alternates)", () => {
    const raw = JSON.stringify({
      items: [{ base: "食べる", tense: "past polite", expected: "食べました", alternates: ["たべました"] }],
    });
    const out = parseConjugationBatch(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.alternates).toEqual(["たべました"]);
  });
  it("alternates is optional", () => {
    const raw = JSON.stringify({
      items: [{ base: "食べる", tense: "past polite", expected: "食べました" }],
    });
    expect(parseConjugationBatch(raw)[0]!.alternates).toBeUndefined();
  });
  it("throws when expected is missing", () => {
    expect(() => parseConjugationBatch(JSON.stringify({
      items: [{ base: "食べる", tense: "past polite" }],
    }))).toThrow();
  });
  it("throws when alternates is not a string array", () => {
    expect(() => parseConjugationBatch(JSON.stringify({
      items: [{ base: "x", tense: "y", expected: "z", alternates: [1,2,3] }],
    }))).toThrow();
  });
  it("strips fences", () => {
    const inner = JSON.stringify({ items: [{ base: "x", tense: "y", expected: "z" }] });
    expect(parseConjugationBatch("```json\n" + inner + "\n```")).toHaveLength(1);
  });
});

describe("parseParticleBatch", () => {
  it("returns items with sentence_japanese_blanked, options (4), answer_index, explanation", () => {
    const raw = JSON.stringify({
      items: [{
        sentence_japanese_blanked: "学校___行きます。",
        options: ["は", "が", "に", "を"],
        answer_index: 2,
        explanation: "に marks the destination of movement.",
      }],
    });
    const out = parseParticleBatch(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.options).toHaveLength(4);
    expect(out[0]!.answer_index).toBe(2);
  });

  it("throws when options is not a 4-element array", () => {
    expect(() => parseParticleBatch(JSON.stringify({
      items: [{ sentence_japanese_blanked: "x", options: ["a","b","c"], answer_index: 0, explanation: "y" }],
    }))).toThrow();
  });

  it("throws when answer_index is out of range", () => {
    expect(() => parseParticleBatch(JSON.stringify({
      items: [{ sentence_japanese_blanked: "x", options: ["a","b","c","d"], answer_index: 4, explanation: "y" }],
    }))).toThrow();
  });

  it("throws when a required field is missing", () => {
    expect(() => parseParticleBatch(JSON.stringify({
      items: [{ sentence_japanese_blanked: "x", options: ["a","b","c","d"], answer_index: 0 }],
    }))).toThrow();
  });

  it("strips ```json fences", () => {
    const inner = JSON.stringify({
      items: [{ sentence_japanese_blanked: "x", options: ["a","b","c","d"], answer_index: 0, explanation: "y" }],
    });
    expect(parseParticleBatch("```json\n" + inner + "\n```")).toHaveLength(1);
  });
});

describe("parseReadingBatch", () => {
  it("returns items with passage_japanese/question_english/answer_english", () => {
    const raw = JSON.stringify({
      items: [{ passage_japanese: "山田さんは...", question_english: "What does Yamada do?", answer_english: "He is a teacher." }],
    });
    const out = parseReadingBatch(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.passage_japanese).toContain("山田");
  });
  it("answer_japanese is optional", () => {
    const raw = JSON.stringify({
      items: [{ passage_japanese: "x", question_english: "y", answer_english: "z", answer_japanese: "w" }],
    });
    expect(parseReadingBatch(raw)[0]!.answer_japanese).toBe("w");
  });
  it("throws on missing required field", () => {
    expect(() => parseReadingBatch(JSON.stringify({
      items: [{ passage_japanese: "x", question_english: "y" }],
    }))).toThrow();
  });
  it("strips fences", () => {
    const inner = JSON.stringify({ items: [{ passage_japanese: "x", question_english: "y", answer_english: "z" }] });
    expect(parseReadingBatch("```json\n" + inner + "\n```")).toHaveLength(1);
  });
});

describe("parseManualVocab", () => {
  it("parses a single object (no items wrapper)", () => {
    const raw = JSON.stringify({
      japanese: "食べる",
      english: "to eat",
      sentence_japanese: "ご飯を食べる。",
      sentence_english: "I eat rice.",
    });
    const out = parseManualVocab(raw);
    expect(out).toEqual({
      japanese: "食べる",
      english: "to eat",
      sentence_japanese: "ご飯を食べる。",
      sentence_english: "I eat rice.",
    });
  });

  it("strips fences", () => {
    const inner = JSON.stringify({
      japanese: "猫", english: "cat", sentence_japanese: "猫が好き。", sentence_english: "I like cats.",
    });
    expect(parseManualVocab("```json\n" + inner + "\n```").japanese).toBe("猫");
  });

  it("throws on missing required field", () => {
    expect(() => parseManualVocab(JSON.stringify({ japanese: "x", english: "y" }))).toThrow();
  });
});

describe("parseExplainBatch", () => {
  it("parses valid explain items", () => {
    const raw = JSON.stringify({ items: [
      {
        task_english: "Explain to a colleague why you migrated to TiDB.",
        task_japanese: "同僚に、TiDBへ移行する理由を説明してください。",
        required_connectives: ["つまり", "その結果", "一方で"],
        register: "polite",
        model_explanation_japanese: "まず結論として、TiDBに移行しました。その結果、拡張性が向上しました。",
        rubric_notes: "Should state conclusion first, then reasons.",
      },
    ]});
    const items = parseExplainBatch(raw);
    expect(items).toHaveLength(1);
    expect(items).toMatchObject([
      { register: "polite", required_connectives: ["つまり", "その結果", "一方で"] },
    ]);
  });

  it("throws when register is invalid", () => {
    const raw = JSON.stringify({ items: [
      { task_english: "x", task_japanese: "x", required_connectives: [], register: "shouting",
        model_explanation_japanese: "x", rubric_notes: "x" },
    ]});
    expect(() => parseExplainBatch(raw)).toThrow();
  });

  it("throws when required_connectives is not a string array", () => {
    const raw = JSON.stringify({ items: [
      { task_english: "x", task_japanese: "x", required_connectives: [1, 2], register: "casual",
        model_explanation_japanese: "x", rubric_notes: "x" },
    ]});
    expect(() => parseExplainBatch(raw)).toThrow();
  });
});

describe("parseExplainGrade", () => {
  it("parses a valid grade", () => {
    const raw = JSON.stringify({
      connective_use: 0.8, structure: 0.7, register: 1.0, grammar: 0.9, overall: 0.82,
      corrected_japanese: "結論として、移行しました。", feedback: "Good structure.",
    });
    const g = parseExplainGrade(raw);
    expect(g.overall).toBeCloseTo(0.82);
    expect(g.corrected_japanese).toContain("移行");
  });

  it("clamps out-of-range scores into 0..1", () => {
    const raw = JSON.stringify({
      connective_use: 1.4, structure: -0.2, register: 0.5, grammar: 0.5, overall: 2,
      corrected_japanese: "x", feedback: "x",
    });
    const g = parseExplainGrade(raw);
    expect(g.connective_use).toBe(1);
    expect(g.structure).toBe(0);
    expect(g.overall).toBe(1);
  });

  it("throws when a score is missing", () => {
    const raw = JSON.stringify({ structure: 0.5, register: 0.5, grammar: 0.5, overall: 0.5,
      corrected_japanese: "x", feedback: "x" });
    expect(() => parseExplainGrade(raw)).toThrow();
  });
});

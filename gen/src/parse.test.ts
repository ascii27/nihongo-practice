import { describe, it, expect } from "vitest";
import { parseVocabBatch, parseSentencesForCards, stripFences } from "./parse.js";

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

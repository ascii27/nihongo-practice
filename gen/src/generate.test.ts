import { describe, it, expect, vi } from "vitest";
import {
  generateVocabBatch,
  generateSentencesForCards,
  GenerateError,
} from "./generate.js";

function fakeClient(responses: Array<{ text: string; in?: number; out?: number }>) {
  const create = vi.fn();
  for (const r of responses) {
    create.mockResolvedValueOnce({
      content: [{ type: "text", text: r.text }],
      usage: { input_tokens: r.in ?? 100, output_tokens: r.out ?? 50 },
    });
  }
  return { client: { messages: { create } } as never, create };
}

describe("generateVocabBatch", () => {
  it("returns parsed items + accumulated usage on the first attempt", async () => {
    const { client, create } = fakeClient([{
      text: JSON.stringify({
        items: [
          { target: "本", sentence_japanese: "本を読む。", sentence_english: "Read a book." },
          { target: "水", sentence_japanese: "水を飲む。", sentence_english: "Drink water." },
        ],
      }),
      in: 120, out: 60,
    }]);
    const r = await generateVocabBatch({ count: 2, client });
    expect(r.items.map((i) => i.target)).toEqual(["本", "水"]);
    expect(r.usage).toEqual({ input_tokens: 120, output_tokens: 60 });
    expect(typeof r.raw).toBe("string");
    expect(create).toHaveBeenCalledOnce();
    const arg = create.mock.calls[0]![0];
    expect(arg.model).toMatch(/sonnet/);
    expect(arg.messages[0].content).toContain("2");
  });

  it("retries on parse failure and returns success when a later attempt parses", async () => {
    const ok = JSON.stringify({
      items: [{ target: "本", sentence_japanese: "本。", sentence_english: "A book." }],
    });
    const { client, create } = fakeClient([
      { text: "garbage", in: 10, out: 5 },
      { text: ok, in: 10, out: 5 },
    ]);
    const r = await generateVocabBatch({ count: 1, client });
    expect(create).toHaveBeenCalledTimes(2);
    expect(r.items).toHaveLength(1);
    // Usage accumulates across all attempts (we billed for both calls).
    expect(r.usage).toEqual({ input_tokens: 20, output_tokens: 10 });
  });

  it("throws GenerateError carrying accumulated usage and last raw text after retries exhausted", async () => {
    const { client, create } = fakeClient([
      { text: "garbage1", in: 10, out: 5 },
      { text: "garbage2", in: 10, out: 5 },
      { text: "garbage3", in: 10, out: 5 },
    ]);
    let err: unknown;
    try { await generateVocabBatch({ count: 1, client }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(GenerateError);
    const ge = err as GenerateError;
    expect(ge.usage).toEqual({ input_tokens: 30, output_tokens: 15 });
    expect(ge.raw).toBe("garbage3");
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("includes the weakness hint in the user prompt when provided", async () => {
    const { client, create } = fakeClient([{
      text: JSON.stringify({ items: [
        { target: "本", sentence_japanese: "本。", sentence_english: "A book." },
      ]}),
    }]);
    await generateVocabBatch({ count: 1, weakness_hint: "verbs for cooking", client });
    const arg = create.mock.calls[0]![0];
    expect(arg.messages[0].content).toContain("verbs for cooking");
  });

  it("returns a deterministic fixture when NIHONGO_FAKE_AI=1", async () => {
    const prev = process.env.NIHONGO_FAKE_AI;
    process.env.NIHONGO_FAKE_AI = "1";
    try {
      const r = await generateVocabBatch({ count: 3 });
      expect(r.items).toHaveLength(3);
      for (const it of r.items) {
        expect(typeof it.target).toBe("string");
        expect(it.target.length).toBeGreaterThan(0);
        expect(it.sentence_japanese.length).toBeGreaterThan(0);
        expect(it.sentence_english.length).toBeGreaterThan(0);
      }
      expect(r.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
    } finally {
      if (prev === undefined) delete process.env.NIHONGO_FAKE_AI;
      else process.env.NIHONGO_FAKE_AI = prev;
    }
  });

  it("clamps fixture length to the requested count", async () => {
    const prev = process.env.NIHONGO_FAKE_AI;
    process.env.NIHONGO_FAKE_AI = "1";
    try {
      const r = await generateVocabBatch({ count: 1 });
      expect(r.items).toHaveLength(1);
    } finally {
      if (prev === undefined) delete process.env.NIHONGO_FAKE_AI;
      else process.env.NIHONGO_FAKE_AI = prev;
    }
  });
});

describe("generateSentencesForCards", () => {
  it("returns parsed sentences", async () => {
    const { client } = fakeClient([{
      text: JSON.stringify({
        sentences: [
          { external_id: "a", sentence_japanese: "本。", sentence_english: "A book." },
        ],
      }),
    }]);
    const r = await generateSentencesForCards(
      [{ external_id: "a", japanese: "本", english: "book" }],
      { client },
    );
    expect(r.sentences).toHaveLength(1);
    expect(r.usage.input_tokens).toBe(100);
  });
});

import { generateGrammarBatch, generateParticleBatch, generateConjugationBatch } from "./generate.js";

describe("generateGrammarBatch", () => {
  it("calls the SDK with grammar system prompt and returns parsed items", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ items: [
        { pattern: "〜ながら", sentence_japanese: "歩きながら話す。", sentence_english: "Talk while walking.", explanation: "..." },
      ]})}],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const r = await generateGrammarBatch({ count: 1, client: { messages: { create } } as never });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.pattern).toBe("〜ながら");
    const arg = create.mock.calls[0]![0];
    expect(arg.system).toMatch(/grammar/i);
  });

  it("returns a deterministic fixture when NIHONGO_FAKE_AI=1", async () => {
    const prev = process.env.NIHONGO_FAKE_AI;
    process.env.NIHONGO_FAKE_AI = "1";
    try {
      const r = await generateGrammarBatch({ count: 2 });
      expect(r.items).toHaveLength(2);
      for (const it of r.items) {
        expect(typeof it.pattern).toBe("string");
        expect(it.pattern.length).toBeGreaterThan(0);
        expect(it.sentence_japanese.length).toBeGreaterThan(0);
        expect(it.explanation.length).toBeGreaterThan(0);
      }
      expect(r.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
    } finally {
      if (prev === undefined) delete process.env.NIHONGO_FAKE_AI;
      else process.env.NIHONGO_FAKE_AI = prev;
    }
  });
});

describe("generateParticleBatch", () => {
  it("returns parsed particle items from the SDK", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ items: [
        { sentence_japanese_blanked: "学校___行きます。", options: ["は","が","に","を"], answer_index: 2, explanation: "..." },
      ]})}],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const r = await generateParticleBatch({ count: 1, client: { messages: { create } } as never });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.options).toHaveLength(4);
  });

  it("returns fake fixture under NIHONGO_FAKE_AI=1", async () => {
    const prev = process.env.NIHONGO_FAKE_AI;
    process.env.NIHONGO_FAKE_AI = "1";
    try {
      const r = await generateParticleBatch({ count: 2 });
      expect(r.items).toHaveLength(2);
      for (const it of r.items) {
        expect(it.options).toHaveLength(4);
        expect(it.answer_index).toBeGreaterThanOrEqual(0);
        expect(it.answer_index).toBeLessThanOrEqual(3);
      }
    } finally {
      if (prev === undefined) delete process.env.NIHONGO_FAKE_AI;
      else process.env.NIHONGO_FAKE_AI = prev;
    }
  });
});

describe("generateConjugationBatch", () => {
  it("returns parsed conjugation items from the SDK", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ items: [
        { base: "食べる", tense: "past polite", expected: "食べました" },
      ]})}],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const r = await generateConjugationBatch({ count: 1, client: { messages: { create } } as never });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.expected).toBe("食べました");
  });
  it("returns fake fixture under NIHONGO_FAKE_AI=1", async () => {
    const prev = process.env.NIHONGO_FAKE_AI;
    process.env.NIHONGO_FAKE_AI = "1";
    try {
      const r = await generateConjugationBatch({ count: 2 });
      expect(r.items).toHaveLength(2);
    } finally {
      if (prev === undefined) delete process.env.NIHONGO_FAKE_AI;
      else process.env.NIHONGO_FAKE_AI = prev;
    }
  });
});

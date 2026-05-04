import { describe, it, expect, vi } from "vitest";
import { generateBatch, parseBatchResponse } from "./generate.js";
import type { CardInput } from "./parse-xml.js";

describe("parseBatchResponse", () => {
  it("returns sentences keyed by external_id", () => {
    const raw = JSON.stringify({
      sentences: [
        { external_id: "a", sentence_japanese: "私は本を読みます。", sentence_english: "I read a book." },
        { external_id: "b", sentence_japanese: "水を飲みます。", sentence_english: "I drink water." },
      ],
    });
    expect(parseBatchResponse(raw)).toEqual([
      { external_id: "a", sentence_japanese: "私は本を読みます。", sentence_english: "I read a book." },
      { external_id: "b", sentence_japanese: "水を飲みます。", sentence_english: "I drink water." },
    ]);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseBatchResponse("not json")).toThrow();
  });

  it("throws when entries are missing required fields", () => {
    const raw = JSON.stringify({ sentences: [{ external_id: "a" }] });
    expect(() => parseBatchResponse(raw)).toThrow();
  });
});

describe("generateBatch", () => {
  it("calls the client with a strict-JSON prompt and returns parsed sentences", async () => {
    const cards: CardInput[] = [
      { external_id: "a", japanese: "本", english: "book" },
      { external_id: "b", japanese: "水", english: "water" },
    ];
    const fakeText = JSON.stringify({
      sentences: [
        { external_id: "a", sentence_japanese: "私は本を読みます。", sentence_english: "I read a book." },
        { external_id: "b", sentence_japanese: "水を飲みます。", sentence_english: "I drink water." },
      ],
    });
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: fakeText }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const fakeClient = { messages: { create } };

    const result = await generateBatch(cards, { client: fakeClient as never });
    expect(result.sentences.map((s) => s.external_id)).toEqual(["a", "b"]);
    expect(create).toHaveBeenCalledOnce();
    const arg = create.mock.calls[0][0];
    expect(arg.model).toMatch(/sonnet/);
    expect(typeof arg.system).toBe("string");
    expect(arg.messages[0].content).toContain("本");
    expect(arg.messages[0].content).toContain("water");
  });

  it("retries once on parse failure", async () => {
    const cards: CardInput[] = [{ external_id: "a", japanese: "本", english: "book" }];
    const create = vi.fn()
      .mockResolvedValueOnce({ content: [{ type: "text", text: "garbage" }], usage: { input_tokens: 10, output_tokens: 5 } })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify({ sentences: [{ external_id: "a", sentence_japanese: "本。", sentence_english: "A book." }] }) }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    const fakeClient = { messages: { create } };
    const result = await generateBatch(cards, { client: fakeClient as never });
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.sentences).toHaveLength(1);
  });
});

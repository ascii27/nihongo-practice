import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { runGeneration } from "./generate.js";

beforeEach(() => resetDb());

function fakeGenClient(items: Array<{ target: string; sentence_japanese: string; sentence_english: string }>) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify({ items }) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  };
}

describe("runVocabGeneration", () => {
  it("inserts one item per parsed entry, writes a success row, returns inserted items", async () => {
    const client = fakeGenClient([
      { target: "本", sentence_japanese: "本を読む。", sentence_english: "Read a book." },
      { target: "水", sentence_japanese: "水を飲む。", sentence_english: "Drink water." },
    ]);
    const r = await runGeneration({ skill: "vocab", count: 2, client });
    expect(r.status).toBe("success");
    expect(r.items_created).toBe(2);
    expect(r.items).toHaveLength(2);
    expect(r.cost_usd).toBeGreaterThan(0);

    const items = await pool.query("SELECT source, prompt, answer FROM items");
    expect(items.rowCount).toBe(2);
    expect(items.rows[0].source).toBe("ai");
    expect(items.rows[0].prompt.sentence_ruby).toContain("<ruby>");
    expect(items.rows[0].answer.reading).toMatch(/^[ぁ-ゖー]+$/);

    const gens = await pool.query("SELECT status, count_requested, count_inserted, cost_usd, response, prompt FROM generations");
    expect(gens.rowCount).toBe(1);
    expect(gens.rows[0].status).toBe("success");
    expect(gens.rows[0].count_requested).toBe(2);
    expect(gens.rows[0].count_inserted).toBe(2);
    expect(gens.rows[0].response).not.toBeNull();
    expect(gens.rows[0].prompt).toMatchObject({ count: 2 });
  });

  it("marks status=partial when fewer items are returned than requested", async () => {
    const client = fakeGenClient([
      { target: "本", sentence_japanese: "本。", sentence_english: "A book." },
    ]);
    const r = await runGeneration({ skill: "vocab", count: 3, client });
    expect(r.status).toBe("partial");
    expect(r.items_created).toBe(1);
    const gens = await pool.query("SELECT status FROM generations");
    expect(gens.rows[0].status).toBe("partial");
  });

  it("writes a failed row and rethrows when generation fails", async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "garbage" }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      },
    };
    let err: unknown;
    try { await runGeneration({ skill: "vocab", count: 2, client }); } catch (e) { err = e; }
    expect(err).toBeDefined();
    const items = await pool.query("SELECT count(*)::int AS c FROM items");
    expect(items.rows[0].c).toBe(0);
    const gens = await pool.query("SELECT status, count_inserted, error, response, input_tokens FROM generations");
    expect(gens.rowCount).toBe(1);
    expect(gens.rows[0].status).toBe("failed");
    expect(gens.rows[0].count_inserted).toBe(0);
    expect(gens.rows[0].input_tokens).toBe(30); // 3 attempts × 10 tokens
    expect(gens.rows[0].error).toBeTruthy();
    expect(gens.rows[0].response).toMatchObject({ text: "garbage" });
  });

  it("stores the weakness_hint when provided", async () => {
    const client = fakeGenClient([
      { target: "本", sentence_japanese: "本。", sentence_english: "A book." },
    ]);
    await runGeneration({ skill: "vocab", count: 1, weakness_hint: "particles", client });
    const gens = await pool.query("SELECT weakness_hint FROM generations");
    expect(gens.rows[0].weakness_hint).toBe("particles");
  });
});

function fakeGrammarClient(items: Array<{ pattern: string; sentence_japanese: string; sentence_english: string; explanation: string }>) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify({ items }) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  };
}

describe("runGeneration grammar", () => {
  it("inserts grammar items with sentence_ruby + sentence_english, writes generations row", async () => {
    const client = fakeGrammarClient([
      { pattern: "〜ながら", sentence_japanese: "音楽を聞きながら勉強します。", sentence_english: "I study while listening to music.", explanation: "..." },
      { pattern: "〜たい", sentence_japanese: "寿司を食べたいです。", sentence_english: "I want to eat sushi.", explanation: "..." },
    ]);
    const r = await runGeneration({ skill: "grammar", count: 2, client });
    expect(r.status).toBe("success");
    expect(r.items_created).toBe(2);

    const items = await pool.query("SELECT skill, prompt, answer FROM items ORDER BY created_at");
    expect(items.rowCount).toBe(2);
    expect(items.rows[0].skill).toBe("grammar");
    expect(items.rows[0].prompt.sentence_ruby).toContain("<ruby>");
    expect(items.rows[0].prompt.pattern).toBe("〜ながら");
    expect(items.rows[0].answer.explanation).toBeTruthy();

    const gens = await pool.query("SELECT skill, status, count_inserted FROM generations");
    expect(gens.rows[0].skill).toBe("grammar");
    expect(gens.rows[0].status).toBe("success");
    expect(gens.rows[0].count_inserted).toBe(2);
  });
});

describe("runGeneration particle", () => {
  it("inserts particle items with sentence_ruby_blanked + 4 options + answer_index", async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: JSON.stringify({ items: [
            { sentence_japanese_blanked: "学校___行きます。", options: ["は","が","に","を"], answer_index: 2, explanation: "..." },
          ]})}],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      },
    };
    const r = await runGeneration({ skill: "particle", count: 1, client });
    expect(r.status).toBe("success");
    expect(r.items_created).toBe(1);

    const items = await pool.query("SELECT skill, prompt, answer FROM items");
    expect(items.rows[0].skill).toBe("particle");
    expect(items.rows[0].prompt.sentence_ruby_blanked).toContain("<ruby>");
    expect(items.rows[0].prompt.options).toEqual(["は","が","に","を"]);
    expect(items.rows[0].prompt.answer_index).toBe(2);
    expect(items.rows[0].answer.explanation).toBeTruthy();
  });
});

describe("runGeneration conjugation", () => {
  it("inserts conjugation items with base/base_ruby/tense/expected/expected_ruby", async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: JSON.stringify({ items: [
            { base: "食べる", tense: "past polite", expected: "食べました", alternates: ["たべました"] },
          ]})}],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      },
    };
    const r = await runGeneration({ skill: "conjugation", count: 1, client });
    expect(r.status).toBe("success");

    const items = await pool.query("SELECT skill, prompt, answer FROM items");
    expect(items.rows[0].skill).toBe("conjugation");
    expect(items.rows[0].prompt.base).toBe("食べる");
    expect(items.rows[0].prompt.base_ruby).toContain("<ruby>");
    expect(items.rows[0].prompt.tense).toBe("past polite");
    expect(items.rows[0].answer.expected).toBe("食べました");
    expect(items.rows[0].answer.expected_ruby).toContain("<ruby>");
    expect(items.rows[0].answer.alternates).toEqual(["たべました"]);
  });
});

describe("runGeneration reading", () => {
  it("inserts reading items with passage_ruby + answer fields", async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: JSON.stringify({ items: [
            { passage_japanese: "山田さんは先生です。", question_english: "What is Yamada's job?", answer_english: "Teacher.", answer_japanese: "先生です。" },
          ]})}],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      },
    };
    const r = await runGeneration({ skill: "reading", count: 1, client });
    expect(r.status).toBe("success");

    const items = await pool.query("SELECT skill, prompt, answer FROM items");
    expect(items.rows[0].skill).toBe("reading");
    expect(items.rows[0].prompt.passage_ruby).toContain("<ruby>");
    expect(items.rows[0].prompt.question_english).toBe("What is Yamada's job?");
    expect(items.rows[0].answer.answer_english).toBe("Teacher.");
    expect(items.rows[0].answer.answer_japanese_ruby).toContain("<ruby>");
  });
});

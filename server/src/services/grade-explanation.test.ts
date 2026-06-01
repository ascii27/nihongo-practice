import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { gradeExplanation, gradeToResult } from "./grade-explanation.js";

beforeEach(() => resetDb());

async function insertExplainItem(): Promise<string> {
  const r = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ('explain', $1, $2, 'ai', $3) RETURNING id`,
    [
      JSON.stringify({
        task_english: "Explain why you migrated to TiDB.",
        task_japanese_ruby: "<ruby>移行<rt>いこう</rt></ruby>",
        required_connectives: ["つまり", "その結果"],
        register: "polite",
      }),
      JSON.stringify({ model_explanation_ruby: "x", rubric_notes: "x" }),
      `e-${Math.random()}`,
    ],
  );
  return r.rows[0].id;
}

function fakeGradeClient(grade: Record<string, unknown>) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify(grade) }],
        usage: { input_tokens: 80, output_tokens: 40 },
      }),
    },
  };
}

describe("gradeToResult", () => {
  it("maps overall >= 0.6 to got_it and below to missed", () => {
    expect(gradeToResult(0.6)).toBe("got_it");
    expect(gradeToResult(0.59)).toBe("missed");
    expect(gradeToResult(1)).toBe("got_it");
  });
});

describe("gradeExplanation", () => {
  it("grades an item, enriches corrected_ruby, returns result + cost", async () => {
    const itemId = await insertExplainItem();
    const client = fakeGradeClient({
      connective_use: 0.8, structure: 0.7, register: 1, grammar: 0.9, overall: 0.82,
      corrected_japanese: "結論として、移行しました。", feedback: "Good.",
    });
    const r = await gradeExplanation({ item_id: itemId, answer_given: "移行しました。", client });
    expect(r.result).toBe("got_it");
    expect(r.grade.overall).toBeCloseTo(0.82);
    expect(r.grade.corrected_ruby).toContain("<ruby>");
    expect(r.cost_usd).toBeGreaterThan(0);
  });

  it("throws when the item does not exist", async () => {
    const client = fakeGradeClient({ connective_use: 1, structure: 1, register: 1, grammar: 1, overall: 1, corrected_japanese: "x", feedback: "x" });
    await expect(
      gradeExplanation({ item_id: "00000000-0000-0000-0000-000000000000", answer_given: "x", client }),
    ).rejects.toThrow();
  });

  it("throws when the item is not an explain item", async () => {
    const r = await pool.query(
      `INSERT INTO items (skill, prompt, answer, source, external_id)
       VALUES ('vocab', '{}', '{}', 'ai', $1) RETURNING id`, [`v-${Math.random()}`],
    );
    const client = fakeGradeClient({ connective_use: 1, structure: 1, register: 1, grammar: 1, overall: 1, corrected_japanese: "x", feedback: "x" });
    await expect(
      gradeExplanation({ item_id: r.rows[0].id, answer_given: "x", client }),
    ).rejects.toThrow();
  });
});

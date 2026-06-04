import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { explainRouter } from "./explain.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/explain", explainRouter));

beforeEach(async () => {
  await resetDb();
  process.env.NIHONGO_FAKE_AI = "1";
});

async function insertExplainItem(): Promise<string> {
  const r = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ('explain', $1, $2, 'ai', $3) RETURNING id`,
    [
      JSON.stringify({ task_english: "Explain X.", task_japanese_ruby: "<ruby>説明<rt>せつめい</rt></ruby>", required_connectives: ["つまり"], register: "polite" }),
      JSON.stringify({ model_explanation_ruby: "x", rubric_notes: "x" }),
      `e-${Math.random()}`,
    ],
  );
  return r.rows[0].id;
}

describe("POST /api/explain/grade", () => {
  it("grades a valid attempt and maps to got_it", async () => {
    const itemId = await insertExplainItem();
    const res = await request(app)
      .post("/api/explain/grade")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: itemId, answer_given: "結論として移行しました。その結果、改善しました。" });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe("got_it");
    expect(res.body.grade.corrected_ruby).toContain("<ruby>");
    expect(typeof res.body.cost_usd).toBe("number");
  });

  it("400s on invalid body", async () => {
    const res = await request(app)
      .post("/api/explain/grade")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: "not-a-uuid", answer_given: "" });
    expect(res.status).toBe(400);
  });

  it("404s when item is missing", async () => {
    const res = await request(app)
      .post("/api/explain/grade")
      .set("X-Passcode", PASSCODE)
      .send({ item_id: "00000000-0000-0000-0000-000000000000", answer_given: "x" });
    expect(res.status).toBe(404);
  });
});

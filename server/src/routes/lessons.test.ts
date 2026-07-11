import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { lessonsRouter } from "./lessons.js";
import { pool } from "../db/pool.js";
import { buildQueue } from "../services/queue.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/lessons", lessonsRouter));

async function pollReady(id: string): Promise<string> {
  let status = "generating";
  for (let i = 0; i < 200 && status === "generating"; i++) {
    const s = await request(app).get(`/api/lessons/${id}/status`).set("X-Passcode", PASSCODE);
    status = s.body.status;
    if (status === "generating") await new Promise((r) => setTimeout(r, 50));
  }
  return status;
}

beforeEach(async () => {
  process.env.NIHONGO_FAKE_AI = "1";
  await resetDb();
});

describe("lessons routes (grammar-centered)", () => {
  it("creates an auto lesson and walks it through ordered blocks", async () => {
    const create = await request(app).post("/api/lessons").set("X-Passcode", PASSCODE)
      .send({ mode: "auto", theme: "giving advice", jlpt_level: "N5" });
    expect(create.status).toBe(200);
    expect(create.body.status).toBe("generating");
    const id = create.body.id as string;

    expect(await pollReady(id)).toBe("ready");

    const detail = await request(app).get(`/api/lessons/${id}`).set("X-Passcode", PASSCODE);
    expect(detail.status).toBe(200);
    const types = detail.body.blocks.map((b: { type: string }) => b.type);
    // grammar first, then vocab, then the practice block ending in cloze.
    expect(types[0]).toBe("grammar");
    expect(types).toContain("vocab");
    expect(types).toContain("reading");
    expect(types).toContain("listening");
    expect(types).toContain("quiz");
    expect(types[types.length - 1]).toBe("cloze");

    const grammar = detail.body.blocks.find((b: { type: string }) => b.type === "grammar");
    expect(Array.isArray(grammar.steps)).toBe(true);
    expect(grammar.steps.length).toBeGreaterThan(0);
    expect(grammar.point.title.length).toBeGreaterThan(0);
  });

  it("keeps reading/listening out of the SRS while vocab/quiz/cloze enter it", async () => {
    const create = await request(app).post("/api/lessons").set("X-Passcode", PASSCODE)
      .send({ mode: "auto", theme: "at the station", jlpt_level: "N5" });
    const id = create.body.id as string;
    expect(await pollReady(id)).toBe("ready");

    // No reading/listening rows were ever inserted into `items`.
    const skills = await pool.query<{ skill: string }>(
      `SELECT DISTINCT i.skill FROM items i JOIN lesson_items li ON li.item_id = i.id WHERE li.lesson_id = $1`,
      [id],
    );
    const skillSet = skills.rows.map((r) => r.skill);
    expect(skillSet).not.toContain("reading");
    expect(skillSet).not.toContain("listening");
    expect(skillSet).toContain("vocab");
    expect(skillSet).toContain("particle"); // quiz + cloze are particle-shaped MCQ

    // The review queue's "new" bucket contains lesson items but no reading/listening.
    const queue = await buildQueue({ limit: 50, tz: "UTC" });
    for (const rec of queue.new) {
      expect(rec.skill).not.toBe("reading");
      expect(rec.skill).not.toBe("listening");
    }
    expect(queue.new.length).toBeGreaterThan(0);
  });

  it("creates a manual lesson from chosen grammar points", async () => {
    const gp = await pool.query<{ id: string }>(`SELECT id FROM grammar_points WHERE jlpt_level = 'N5' ORDER BY sort_order LIMIT 2`);
    const ids = gp.rows.map((r) => r.id);
    expect(ids.length).toBe(2);

    const create = await request(app).post("/api/lessons").set("X-Passcode", PASSCODE)
      .send({ mode: "manual", grammar_point_ids: ids, jlpt_level: "N5" });
    expect(create.status).toBe(200);
    const id = create.body.id as string;
    expect(await pollReady(id)).toBe("ready");

    const detail = await request(app).get(`/api/lessons/${id}`).set("X-Passcode", PASSCODE);
    const grammarBlocks = detail.body.blocks.filter((b: { type: string }) => b.type === "grammar");
    expect(grammarBlocks.length).toBe(2);
  });

  it("rejects an invalid create body", async () => {
    const r = await request(app).post("/api/lessons").set("X-Passcode", PASSCODE)
      .send({ mode: "manual", grammar_point_ids: [], jlpt_level: "N5" });
    expect(r.status).toBe(400);
  });

  it("404s an unknown lesson", async () => {
    const r = await request(app).get("/api/lessons/11111111-1111-1111-1111-111111111111").set("X-Passcode", PASSCODE);
    expect(r.status).toBe(404);
  });
});

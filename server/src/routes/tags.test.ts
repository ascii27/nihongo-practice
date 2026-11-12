import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { tagsRouter } from "./tags.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/tags", tagsRouter));
const auth = (r: request.Test) => r.set("X-Passcode", PASSCODE);

async function insertVocab(target: string, meaning: string): Promise<string> {
  const r = await pool.query(
    `INSERT INTO items (skill, prompt, answer, source, external_id)
     VALUES ('vocab', $1, $2, 'seed', $3) RETURNING id`,
    [JSON.stringify({ sentence_ruby: target, target, sentence_english: meaning }),
     JSON.stringify({ meaning, reading: "x" }), `e-${Math.random()}`],
  );
  return r.rows[0].id;
}
async function createTag(name = "Coto Academy"): Promise<string> {
  const res = await auth(request(app).post("/api/tags")).send({ name });
  expect(res.status).toBe(201);
  return res.body.id;
}

beforeEach(async () => { await resetDb(); process.env.NIHONGO_FAKE_AI = "1"; });
afterEach(() => { delete process.env.NIHONGO_FAKE_AI; });

describe("tags", () => {
  it("requires passcode", async () => {
    expect((await request(app).get("/api/tags")).status).toBe(401);
  });

  it("creates and lists a tag with count and mastery", async () => {
    const id = await createTag();
    const a = await insertVocab("水", "water");
    const b = await insertVocab("火", "fire");
    await pool.query(`INSERT INTO review_state (item_id, box) VALUES ($1, 5)`, [a]);
    await auth(request(app).put(`/api/tags/${id}/items/${a}`)).expect(204);
    await auth(request(app).put(`/api/tags/${id}/items/${b}`)).expect(204);
    const res = await auth(request(app).get("/api/tags"));
    expect(res.body.tags).toEqual([
      expect.objectContaining({ id, name: "Coto Academy", item_count: 2, avg_mastery: 0.5 }),
    ]);
  });

  it("trims names and rejects case/whitespace clashes on create and rename", async () => {
    await createTag("Coto Academy");
    const dup = await auth(request(app).post("/api/tags")).send({ name: "  coto academy " });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("TAG_EXISTS");
    const other = await createTag("Week 5");
    const ren = await auth(request(app).patch(`/api/tags/${other}`)).send({ name: "COTO ACADEMY" });
    expect(ren.status).toBe(409);
  });

  it("renames and edits description", async () => {
    const id = await createTag("Week 5");
    await auth(request(app).patch(`/api/tags/${id}`)).send({ name: "Week 6", description: "n4" }).expect(204);
    const res = await auth(request(app).get("/api/tags"));
    expect(res.body.tags[0]).toMatchObject({ name: "Week 6", description: "n4" });
  });

  it("tagging is idempotent and untag removes only the label", async () => {
    const id = await createTag();
    const a = await insertVocab("水", "water");
    await auth(request(app).put(`/api/tags/${id}/items/${a}`)).expect(204);
    await auth(request(app).put(`/api/tags/${id}/items/${a}`)).expect(204);
    await auth(request(app).delete(`/api/tags/${id}/items/${a}`)).expect(204);
    const items = await pool.query(`SELECT count(*)::int AS c FROM items`);
    expect(items.rows[0].c).toBe(1);
    const tagged = await pool.query(`SELECT count(*)::int AS c FROM item_tags`);
    expect(tagged.rows[0].c).toBe(0);
  });

  it("404s tagging an unknown tag or item", async () => {
    const id = await createTag();
    const a = await insertVocab("水", "water");
    const unknown = "00000000-0000-0000-0000-000000000000";
    expect((await auth(request(app).put(`/api/tags/${unknown}/items/${a}`))).body.code).toBe("TAG_NOT_FOUND");
    expect((await auth(request(app).put(`/api/tags/${id}/items/${unknown}`))).body.code).toBe("ITEM_NOT_FOUND");
  });

  it("delete removes the tag but keeps items and review state", async () => {
    const id = await createTag();
    const a = await insertVocab("水", "water");
    await pool.query(`INSERT INTO review_state (item_id, box) VALUES ($1, 3)`, [a]);
    await auth(request(app).put(`/api/tags/${id}/items/${a}`)).expect(204);
    await auth(request(app).delete(`/api/tags/${id}`)).expect(204);
    const rs = await pool.query(`SELECT box FROM review_state WHERE item_id = $1`, [a]);
    expect(rs.rows[0].box).toBe(3);
    expect((await auth(request(app).delete(`/api/tags/${id}`))).status).toBe(404);
  });

  it("quick-add creates a user item and tags it", async () => {
    const id = await createTag();
    const res = await auth(request(app).post(`/api/tags/${id}/quick-add`)).send({
      kind: "vocab", japanese: "テスト", english: "test",
      sentence_japanese: "テストです。", sentence_english: "It's a test.",
    });
    expect(res.status).toBe(201);
    const t = await pool.query(`SELECT 1 FROM item_tags WHERE tag_id = $1 AND item_id = $2`, [id, res.body.item_id]);
    expect(t.rowCount).toBe(1);
  });

  it("preview drafts fields without writing", async () => {
    const res = await auth(request(app).post("/api/tags/preview")).send({ kind: "vocab", input: "test" });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("vocab");
    expect((await pool.query(`SELECT count(*)::int AS c FROM items`)).rows[0].c).toBe(0);
  });

  it("candidates exclude items already carrying the tag and include user_tags", async () => {
    const id = await createTag();
    const a = await insertVocab("水", "water");
    const b = await insertVocab("水曜日", "wednesday");
    await auth(request(app).put(`/api/tags/${id}/items/${a}`)).expect(204);
    const res = await auth(request(app).get(`/api/tags/${id}/candidates?q=水`));
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([b]);
    expect(res.body.items[0].user_tags).toEqual([]);
  });

  it("404s a non-uuid tag id instead of erroring on the cast", async () => {
    expect((await auth(request(app).delete("/api/tags/not-a-uuid"))).status).toBe(404);
  });
});

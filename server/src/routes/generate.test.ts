import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { generateRouter } from "./generate.js";

const PASSCODE = "test-passcode";

const app = makeTestApp(PASSCODE, (a) => a.use("/api/generate", generateRouter));

beforeEach(async () => {
  await resetDb();
  process.env.NIHONGO_FAKE_AI = "1";
});

describe("POST /api/generate", () => {
  it("requires passcode", async () => {
    const res = await request(app).post("/api/generate").send({ skill: "vocab", count: 1 });
    expect(res.status).toBe(401);
  });

  it("inserts items and returns them on success", async () => {
    const res = await request(app)
      .post("/api/generate")
      .set("X-Passcode", PASSCODE)
      .send({ skill: "vocab", count: 2 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.items_created).toBe(2);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.cost_usd).toBe(0); // fake AI reports no usage
    expect(res.body.generation_id).toMatch(/^[0-9a-f-]{36}$/);

    const items = await pool.query("SELECT count(*)::int AS c FROM items WHERE source='ai'");
    expect(items.rows[0].c).toBe(2);
  });

  it("rejects count=0 with 400", async () => {
    const res = await request(app)
      .post("/api/generate").set("X-Passcode", PASSCODE)
      .send({ skill: "vocab", count: 0 });
    expect(res.status).toBe(400);
  });

  it("rejects count=51 with 400", async () => {
    const res = await request(app)
      .post("/api/generate").set("X-Passcode", PASSCODE)
      .send({ skill: "vocab", count: 51 });
    expect(res.status).toBe(400);
  });

  it("rejects missing skill with 400", async () => {
    const res = await request(app)
      .post("/api/generate").set("X-Passcode", PASSCODE)
      .send({ count: 5 });
    expect(res.status).toBe(400);
  });

  it("rejects weakness_hint > 200 chars with 400", async () => {
    const res = await request(app)
      .post("/api/generate").set("X-Passcode", PASSCODE)
      .send({ skill: "vocab", count: 5, weakness_hint: "x".repeat(201) });
    expect(res.status).toBe(400);
  });

  it("returns 502 + failed row when the orchestrator throws", async () => {
    delete process.env.NIHONGO_FAKE_AI;
    const prevKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const res = await request(app)
        .post("/api/generate").set("X-Passcode", PASSCODE)
        .send({ skill: "vocab", count: 2 });
      expect(res.status).toBe(502);
      expect(res.body.status).toBe("failed");
      expect(res.body.items_created).toBe(0);
      expect(res.body.error).toBeTruthy();
      expect(res.body.generation_id).toMatch(/^[0-9a-f-]{36}$/);
      const gens = await pool.query("SELECT status FROM generations");
      expect(gens.rows[0].status).toBe("failed");
    } finally {
      if (prevKey) process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });
});

describe("POST /api/generate (grammar)", () => {
  it("inserts grammar items when skill=grammar", async () => {
    const res = await request(app)
      .post("/api/generate")
      .set("X-Passcode", PASSCODE)
      .send({ skill: "grammar", count: 2 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.items_created).toBe(2);

    const r = await pool.query("SELECT count(*)::int AS c FROM items WHERE skill='grammar' AND source='ai'");
    expect(r.rows[0].c).toBe(2);
  });
});

describe("POST /api/generate (particle)", () => {
  it("inserts particle items when skill=particle", async () => {
    const res = await request(app)
      .post("/api/generate")
      .set("X-Passcode", PASSCODE)
      .send({ skill: "particle", count: 2 });
    expect(res.status).toBe(200);
    expect(res.body.items_created).toBe(2);
    const r = await pool.query("SELECT count(*)::int AS c FROM items WHERE skill='particle' AND source='ai'");
    expect(r.rows[0].c).toBe(2);
  });
});

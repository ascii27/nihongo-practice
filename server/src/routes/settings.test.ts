import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { settingsRouter } from "./settings.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/settings", settingsRouter));

let prev: string | undefined;

beforeEach(async () => {
  prev = process.env.ANTHROPIC_API_KEY;
  await resetDb();
});
afterEach(() => { if (prev) process.env.ANTHROPIC_API_KEY = prev; else delete process.env.ANTHROPIC_API_KEY; });

describe("GET /api/settings/status", () => {
  it("requires passcode", async () => {
    const res = await request(app).get("/api/settings/status");
    expect(res.status).toBe(401);
  });

  it("reports configured=true when ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-something";
    const res = await request(app).get("/api/settings/status").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ai_key_configured: true, daily_review_target: 30 });
  });

  it("reports configured=false when ANTHROPIC_API_KEY is empty/unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(app).get("/api/settings/status").set("X-Passcode", PASSCODE);
    expect(res.body).toEqual({ ai_key_configured: false, daily_review_target: 30 });
  });

  it("reports configured=false when ANTHROPIC_API_KEY is whitespace", async () => {
    process.env.ANTHROPIC_API_KEY = "   ";
    const res = await request(app).get("/api/settings/status").set("X-Passcode", PASSCODE);
    expect(res.body).toEqual({ ai_key_configured: false, daily_review_target: 30 });
  });
});

describe("PATCH /api/settings", () => {
  it("requires passcode", async () => {
    const res = await request(app).patch("/api/settings").send({ daily_review_target: 40 });
    expect(res.status).toBe(401);
  });

  it("persists a valid target", async () => {
    const res = await request(app)
      .patch("/api/settings").set("X-Passcode", PASSCODE)
      .send({ daily_review_target: 50 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ daily_review_target: 50 });

    const row = await pool.query(`SELECT daily_review_target FROM app_settings`);
    expect(row.rows[0].daily_review_target).toBe(50);
  });

  it("is reflected by GET /status", async () => {
    await request(app).patch("/api/settings").set("X-Passcode", PASSCODE).send({ daily_review_target: 70 });
    const res = await request(app).get("/api/settings/status").set("X-Passcode", PASSCODE);
    expect(res.body.daily_review_target).toBe(70);
  });

  it("rejects out-of-range and non-multiple-of-10 values", async () => {
    for (const n of [0, 5, 25, 105, 30.5, "40", null]) {
      const res = await request(app)
        .patch("/api/settings").set("X-Passcode", PASSCODE)
        .send({ daily_review_target: n });
      expect(res.status, `value ${JSON.stringify(n)} should be rejected`).toBe(400);
      expect(res.body.code).toBe("INVALID_SETTINGS");
    }
    const row = await pool.query(`SELECT daily_review_target FROM app_settings`);
    expect(row.rows[0].daily_review_target).toBe(30);   // unchanged
  });

  it("accepts both ends of the range", async () => {
    for (const n of [10, 100]) {
      const res = await request(app)
        .patch("/api/settings").set("X-Passcode", PASSCODE)
        .send({ daily_review_target: n });
      expect(res.status).toBe(200);
    }
  });
});

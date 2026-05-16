import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { generationsRouter } from "./generations.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/generations", generationsRouter));

async function insertRow(opts: { offsetSeconds: number; status?: string; cost?: number }) {
  await pool.query(
    `INSERT INTO generations
       (requested_at, skill, count_requested, count_inserted, weakness_hint,
        model, prompt, response, input_tokens, output_tokens, cost_usd, status)
     VALUES (now() - ($1::int * interval '1 second'), 'vocab', 10, 10, NULL,
             'claude-sonnet-4-6', '{"x":1}'::jsonb, '{"text":"raw"}'::jsonb, 100, 50, $2, $3)`,
    [opts.offsetSeconds, opts.cost ?? 0.01, opts.status ?? "success"],
  );
}

beforeEach(() => resetDb());

describe("GET /api/generations", () => {
  it("requires passcode", async () => {
    const res = await request(app).get("/api/generations");
    expect(res.status).toBe(401);
  });

  it("returns rows in requested_at DESC order", async () => {
    await insertRow({ offsetSeconds: 30, status: "success" });
    await insertRow({ offsetSeconds: 10, status: "partial" });
    await insertRow({ offsetSeconds: 20, status: "failed" });
    const res = await request(app).get("/api/generations").set("X-Passcode", PASSCODE);
    expect(res.status).toBe(200);
    expect(res.body.generations.map((g: { status: string }) => g.status))
      .toEqual(["partial", "failed", "success"]);
  });

  it("excludes prompt and response jsonb columns from the response", async () => {
    await insertRow({ offsetSeconds: 5 });
    const res = await request(app).get("/api/generations").set("X-Passcode", PASSCODE);
    const row = res.body.generations[0];
    expect(row).not.toHaveProperty("prompt");
    expect(row).not.toHaveProperty("response");
    expect(row).toHaveProperty("id");
    expect(row).toHaveProperty("status");
    expect(row).toHaveProperty("cost_usd");
    expect(row).toHaveProperty("count_inserted");
  });

  it("honors ?limit=", async () => {
    for (let i = 0; i < 5; i++) await insertRow({ offsetSeconds: i });
    const res = await request(app).get("/api/generations?limit=2").set("X-Passcode", PASSCODE);
    expect(res.body.generations).toHaveLength(2);
  });

  it("honors ?offset=", async () => {
    for (let i = 0; i < 4; i++) await insertRow({ offsetSeconds: i });
    const res = await request(app).get("/api/generations?limit=2&offset=2").set("X-Passcode", PASSCODE);
    expect(res.body.generations).toHaveLength(2);
  });

  it("clamps limit to 50", async () => {
    for (let i = 0; i < 60; i++) await insertRow({ offsetSeconds: i });
    const res = await request(app).get("/api/generations?limit=999").set("X-Passcode", PASSCODE);
    expect(res.body.generations).toHaveLength(50);
  });
});

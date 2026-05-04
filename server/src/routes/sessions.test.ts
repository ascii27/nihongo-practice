import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { pool } from "../db/pool.js";
import { sessionsRouter } from "./sessions.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/sessions", sessionsRouter));

beforeEach(() => resetDb());

describe("POST /api/sessions", () => {
  it("creates a session and returns its id", async () => {
    const res = await request(app)
      .post("/api/sessions")
      .set("X-Passcode", PASSCODE)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);

    const dbRes = await pool.query("SELECT id, ended_at FROM sessions WHERE id = $1", [res.body.id]);
    expect(dbRes.rows).toHaveLength(1);
    expect(dbRes.rows[0].ended_at).toBeNull();
  });

  it("accepts an optional skill_filter", async () => {
    const res = await request(app)
      .post("/api/sessions")
      .set("X-Passcode", PASSCODE)
      .send({ skill_filter: "vocab" });
    expect(res.status).toBe(200);

    const dbRes = await pool.query("SELECT skill_filter FROM sessions WHERE id = $1", [res.body.id]);
    expect(dbRes.rows[0].skill_filter).toBe("vocab");
  });
});

describe("PATCH /api/sessions/:id", () => {
  it("sets ended_at", async () => {
    const start = await request(app).post("/api/sessions").set("X-Passcode", PASSCODE).send({});
    const id = start.body.id;
    const endedAt = new Date().toISOString();
    const res = await request(app)
      .patch(`/api/sessions/${id}`)
      .set("X-Passcode", PASSCODE)
      .send({ ended_at: endedAt });
    expect(res.status).toBe(200);

    const dbRes = await pool.query("SELECT ended_at FROM sessions WHERE id = $1", [id]);
    expect(new Date(dbRes.rows[0].ended_at).toISOString()).toBe(endedAt);
  });

  it("returns 404 for unknown session", async () => {
    const res = await request(app)
      .patch(`/api/sessions/00000000-0000-0000-0000-000000000000`)
      .set("X-Passcode", PASSCODE)
      .send({ ended_at: new Date().toISOString() });
    expect(res.status).toBe(404);
  });
});

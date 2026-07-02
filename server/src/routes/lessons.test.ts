import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { resetDb } from "../db/reset.js";
import { lessonsRouter } from "./lessons.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/lessons", lessonsRouter));

beforeEach(async () => {
  process.env.NIHONGO_FAKE_AI = "1";
  await resetDb();
});

describe("lessons routes", () => {
  it("creates a lesson (generating), reaches ready under fake AI, and becomes today's lesson", async () => {
    const create = await request(app).post("/api/lessons").set("X-Passcode", PASSCODE)
      .send({ topic: "at the station", jlpt_level: "N4", skills: ["vocab", "particle"] });
    expect(create.status).toBe(200);
    expect(create.body.status).toBe("generating");
    const id = create.body.id as string;

    // Poll status until it leaves 'generating' (fake AI completes quickly).
    let status = "generating";
    for (let i = 0; i < 100 && status === "generating"; i++) {
      const s = await request(app).get(`/api/lessons/${id}/status`).set("X-Passcode", PASSCODE);
      status = s.body.status;
      if (status === "generating") await new Promise((r) => setTimeout(r, 50));
    }
    expect(status).toBe("ready");

    const detail = await request(app).get(`/api/lessons/${id}`).set("X-Passcode", PASSCODE);
    expect(detail.status).toBe(200);
    expect(detail.body.sections.map((s: { section: string }) => s.section)).toEqual(["vocab", "particle"]);
    expect(detail.body.sections[0].items.length).toBeGreaterThan(0);

    const today = await request(app).get("/api/lessons/today").set("X-Passcode", PASSCODE);
    expect(today.body.lesson.id).toBe(id);
  });

  it("advances lesson state via PATCH", async () => {
    const create = await request(app).post("/api/lessons").set("X-Passcode", PASSCODE)
      .send({ topic: "greetings", jlpt_level: "N5", skills: ["vocab"] });
    const id = create.body.id as string;
    const patch = await request(app).patch(`/api/lessons/${id}/state`).set("X-Passcode", PASSCODE)
      .send({ progress: "in_progress", current_section: "vocab", current_index: 0 });
    expect(patch.status).toBe(204);
  });

  it("rejects an invalid create body", async () => {
    const r = await request(app).post("/api/lessons").set("X-Passcode", PASSCODE)
      .send({ topic: "", jlpt_level: "N4", skills: [] });
    expect(r.status).toBe(400);
  });

  it("404s an unknown lesson", async () => {
    const r = await request(app).get("/api/lessons/11111111-1111-1111-1111-111111111111").set("X-Passcode", PASSCODE);
    expect(r.status).toBe(404);
  });
});

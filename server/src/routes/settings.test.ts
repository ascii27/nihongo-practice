import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "../test-helpers/app.js";
import { settingsRouter } from "./settings.js";

const PASSCODE = "test-passcode";
const app = makeTestApp(PASSCODE, (a) => a.use("/api/settings", settingsRouter));

let prev: string | undefined;

beforeEach(() => { prev = process.env.ANTHROPIC_API_KEY; });
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
    expect(res.body).toEqual({ ai_key_configured: true });
  });

  it("reports configured=false when ANTHROPIC_API_KEY is empty/unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(app).get("/api/settings/status").set("X-Passcode", PASSCODE);
    expect(res.body).toEqual({ ai_key_configured: false });
  });

  it("reports configured=false when ANTHROPIC_API_KEY is whitespace", async () => {
    process.env.ANTHROPIC_API_KEY = "   ";
    const res = await request(app).get("/api/settings/status").set("X-Passcode", PASSCODE);
    expect(res.body).toEqual({ ai_key_configured: false });
  });
});

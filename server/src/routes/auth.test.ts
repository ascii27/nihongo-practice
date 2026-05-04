import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import express from "express";
import { passcodeMiddleware } from "../middleware/passcode.js";
import { authRouter } from "./auth.js";

function makeApp(passcode: string) {
  const app = express();
  app.use(express.json());
  app.use("/api", passcodeMiddleware(passcode));
  app.use("/api/auth", authRouter);
  return app;
}

describe("POST /api/auth/check", () => {
  const passcode = "test-passcode";
  let app: express.Express;
  beforeAll(() => { app = makeApp(passcode); });

  it("returns 200 with ok when passcode is correct", async () => {
    const res = await request(app)
      .post("/api/auth/check")
      .set("X-Passcode", passcode)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns 401 when passcode is wrong", async () => {
    const res = await request(app)
      .post("/api/auth/check")
      .set("X-Passcode", "wrong-passcode")
      .send({});
    expect(res.status).toBe(401);
  });
});

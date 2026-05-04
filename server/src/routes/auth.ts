import { Router } from "express";

export const authRouter = Router();

authRouter.post("/check", (_req, res) => {
  res.json({ ok: true });
});

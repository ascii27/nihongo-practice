import { Router } from "express";
import { buildQueue } from "../services/queue.js";

export const queueRouter = Router();

queueRouter.get("/", async (req, res) => {
  const skill = req.query.skill;
  if (skill !== undefined && skill !== "vocab") {
    res.status(400).json({ error: "only vocab is supported in phase 1", code: "SKILL_UNSUPPORTED" });
    return;
  }
  const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 500);
  const payload = await buildQueue({ limit });
  res.json(payload);
});

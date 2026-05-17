import { Router } from "express";
import { buildQueue } from "../services/queue.js";

export const queueRouter = Router();

const SUPPORTED_SKILLS = new Set(["vocab", "grammar", "particle", "conjugation"]);

queueRouter.get("/", async (req, res) => {
  const skillParam = req.query.skill;
  let skill: string | undefined;
  if (skillParam !== undefined) {
    if (typeof skillParam !== "string" || !SUPPORTED_SKILLS.has(skillParam)) {
      res.status(400).json({ error: `unsupported skill: ${skillParam}`, code: "SKILL_UNSUPPORTED" });
      return;
    }
    skill = skillParam;
  }
  const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 500);
  const payload = await buildQueue({ limit, skill });
  res.json(payload);
});

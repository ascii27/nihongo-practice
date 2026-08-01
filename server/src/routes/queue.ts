import { Router } from "express";
import { buildQueue } from "../services/queue.js";
import { DEFAULT_QUEUE_LIMIT } from "../services/session-plan.js";
import { resolveTz } from "../services/tz.js";

export const queueRouter = Router();

const SUPPORTED_SKILLS = new Set(["vocab", "grammar", "particle", "conjugation", "reading", "explain", "listening", "kanji"]);

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
  const limit = Math.min(Math.max(Number(req.query.limit ?? DEFAULT_QUEUE_LIMIT), 1), 500);
  const tz = resolveTz(req.query.tz);
  const payload = await buildQueue({ limit, skill, tz });
  res.json(payload);
});

import { Router } from "express";
import { buildQueue, buildFreeQueue } from "../services/queue.js";
import { DEFAULT_QUEUE_LIMIT, FREE_PRACTICE_SIZE } from "../services/session-plan.js";
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
  // Free practice ignores the daily budget and serves a fixed-size session.
  // It has its own default size, so an unspecified `limit` means something
  // different here than it does for the budgeted queue.
  if (req.query.free === "1") {
    const limit = Math.min(Math.max(Number(req.query.limit ?? FREE_PRACTICE_SIZE), 1), 500);
    res.json(await buildFreeQueue({ limit, skill }));
    return;
  }

  const limit = Math.min(Math.max(Number(req.query.limit ?? DEFAULT_QUEUE_LIMIT), 1), 500);
  const tz = resolveTz(req.query.tz);
  const payload = await buildQueue({ limit, skill, tz });
  res.json(payload);
});

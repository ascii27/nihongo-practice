import { Router } from "express";
import { UpdateSettingsRequest } from "@nihongo/shared";
import { pool } from "../db/pool.js";
import { readTarget } from "../services/daily-budget.js";

export const settingsRouter = Router();

settingsRouter.get("/status", async (_req, res) => {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  res.json({
    ai_key_configured: key.trim().length > 0,
    daily_review_target: await readTarget(),
  });
});

settingsRouter.patch("/", async (req, res) => {
  const parsed = UpdateSettingsRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "daily_review_target must be a multiple of 10 between 10 and 100",
      code: "INVALID_SETTINGS",
    });
    return;
  }
  const { daily_review_target } = parsed.data;
  await pool.query(
    `UPDATE app_settings SET daily_review_target = $1, updated_at = now()`,
    [daily_review_target],
  );
  res.json({ daily_review_target });
});

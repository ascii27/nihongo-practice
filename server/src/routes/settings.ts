import { Router } from "express";

export const settingsRouter = Router();

settingsRouter.get("/status", (_req, res) => {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  res.json({ ai_key_configured: key.trim().length > 0 });
});

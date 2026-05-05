import { Router } from "express";
import { computeStreak } from "../services/streak.js";

export const statsRouter = Router();

statsRouter.get("/streak", async (req, res) => {
  const tz = req.query.tz;
  if (typeof tz !== "string" || tz.length === 0) {
    res.status(400).json({ error: "tz query param required (IANA timezone)", code: "TZ_REQUIRED" });
    return;
  }
  // Validate the tz by attempting a no-op conversion. Throws on bad zone.
  try {
    new Date().toLocaleString("en-US", { timeZone: tz });
  } catch {
    res.status(400).json({ error: "invalid tz", code: "TZ_INVALID" });
    return;
  }
  const days = await computeStreak(tz);
  res.json({ days });
});

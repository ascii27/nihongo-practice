import { Router } from "express";
import { JlptLevel } from "@nihongo/shared";
import { listGrammarPoints } from "../services/grammar-points.js";

export const grammarPointsRouter = Router();

// GET /api/grammar-points?level=N4 — the catalog for one JLPT level.
grammarPointsRouter.get("/", async (req, res) => {
  const parsed = JlptLevel.safeParse(req.query.level);
  if (!parsed.success) {
    res.status(400).json({ error: "level query param required (N5, N4, N3, N2, or N1)", code: "LEVEL_REQUIRED" });
    return;
  }
  const grammar_points = await listGrammarPoints(parsed.data);
  res.json({ grammar_points });
});

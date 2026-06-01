import { Router } from "express";
import { ExplainGradeRequest } from "@nihongo/shared";
import { gradeExplanation } from "../services/grade-explanation.js";

export const explainRouter = Router();

const GRADE_TIMEOUT_MS = 60_000;

// POST /api/explain/grade — pure scoring, no DB write. The client records the
// review afterward through POST /api/reviews so the idempotency model is
// untouched. Grading failures surface as 502 with a clear message.
explainRouter.post("/grade", async (req, res) => {
  const parsed = ExplainGradeRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "invalid input", code: "INVALID_INPUT" });
    return;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), GRADE_TIMEOUT_MS);
  try {
    const r = await gradeExplanation({
      item_id: parsed.data.item_id,
      answer_given: parsed.data.answer_given,
      signal: ac.signal,
    });
    res.json({ grade: r.grade, result: r.result, cost_usd: r.cost_usd });
  } catch (err) {
    const message = err instanceof Error ? err.message : "grade failed";
    if (message === "item not found") {
      res.status(404).json({ error: message, code: "ITEM_NOT_FOUND" });
      return;
    }
    if (message === "item is not an explain item") {
      res.status(400).json({ error: message, code: "WRONG_SKILL" });
      return;
    }
    res.status(502).json({ error: message, code: "GRADE_FAILED" });
  } finally {
    clearTimeout(timer);
  }
});

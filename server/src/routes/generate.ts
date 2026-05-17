import { Router } from "express";
import { GenerateRequest } from "@nihongo/shared";
import { runGeneration } from "../services/generate.js";
import { pool } from "../db/pool.js";

export const generateRouter = Router();

const TIMEOUT_MS = 60_000;

generateRouter.post("/", async (req, res) => {
  const parsed = GenerateRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", code: "BAD_BODY", issues: parsed.error.issues });
    return;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await runGeneration({
      skill: parsed.data.skill,
      count: parsed.data.count,
      weakness_hint: parsed.data.weakness_hint,
      signal: ac.signal,
    });
    res.json({
      generation_id: r.generation_id,
      status: r.status,
      items_created: r.items_created,
      cost_usd: r.cost_usd,
      items: r.items,
    });
  } catch (err) {
    const generation_id = await fetchLatestFailedId();
    res.status(502).json({
      generation_id,
      status: "failed" as const,
      items_created: 0 as const,
      cost_usd: 0,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timer);
  }
});

async function fetchLatestFailedId(): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM generations WHERE status='failed' ORDER BY requested_at DESC LIMIT 1`,
  );
  return r.rows[0]?.id ?? "00000000-0000-0000-0000-000000000000";
}

import { Router } from "express";
import { pool } from "../db/pool.js";

export const generationsRouter = Router();

generationsRouter.get("/", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 10), 1), 50);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  const r = await pool.query(
    `SELECT id, requested_at, skill, count_requested, count_inserted,
            weakness_hint, cost_usd, status, error
       FROM generations
      ORDER BY requested_at DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  res.json({
    generations: r.rows.map((row) => ({
      id: row.id,
      requested_at: row.requested_at.toISOString(),
      skill: row.skill,
      count_requested: row.count_requested,
      count_inserted: row.count_inserted,
      weakness_hint: row.weakness_hint,
      cost_usd: Number(row.cost_usd),
      status: row.status,
      error: row.error,
    })),
  });
});

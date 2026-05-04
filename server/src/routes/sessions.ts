import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";

export const sessionsRouter = Router();

const StartBody = z.object({ skill_filter: z.string().optional() });
const EndBody = z.object({ ended_at: z.string() });

sessionsRouter.post("/", async (req, res) => {
  const parsed = StartBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", code: "BAD_BODY" });
    return;
  }
  const { skill_filter } = parsed.data;
  const r = await pool.query(
    `INSERT INTO sessions (skill_filter) VALUES ($1) RETURNING id`,
    [skill_filter ?? null],
  );
  res.json({ id: r.rows[0].id });
});

sessionsRouter.patch("/:id", async (req, res) => {
  const parsed = EndBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", code: "BAD_BODY" });
    return;
  }
  const { id } = req.params;
  const r = await pool.query(
    `UPDATE sessions SET ended_at = $1 WHERE id = $2 RETURNING id`,
    [parsed.data.ended_at, id],
  );
  if (r.rowCount === 0) {
    res.status(404).json({ error: "session not found", code: "NOT_FOUND" });
    return;
  }
  res.json({ ok: true });
});

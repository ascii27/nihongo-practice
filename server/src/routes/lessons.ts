import { Router } from "express";
import { CreateLessonRequest, LessonStateUpdate } from "@nihongo/shared";
import { createLesson, listLessons, getLessonDetail, resolveToday, updateLessonState } from "../services/lessons.js";
import { generateLessonInto } from "../services/lesson-generate.js";
import { pool } from "../db/pool.js";

export const lessonsRouter = Router();

lessonsRouter.post("/", async (req, res) => {
  const parsed = CreateLessonRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", code: "BAD_BODY", issues: parsed.error.issues });
    return;
  }
  const { id } = await createLesson(parsed.data);
  // Fire-and-forget: generation runs in the background; client polls status.
  void generateLessonInto(id, parsed.data.topic, parsed.data.jlpt_level, parsed.data.skills)
    .catch((err) => console.error("lesson generation failed", id, err));
  res.json({ id, status: "generating" as const });
});

lessonsRouter.get("/", async (_req, res) => {
  res.json({ lessons: await listLessons() });
});

lessonsRouter.get("/today", async (_req, res) => {
  res.json(await resolveToday());
});

lessonsRouter.get("/:id/status", async (req, res) => {
  const r = await pool.query<{ status: string; error: string | null }>(
    `SELECT status, error FROM lessons WHERE id = $1`, [req.params.id],
  );
  if (!r.rows[0]) { res.status(404).json({ error: "not found" }); return; }
  res.json({ status: r.rows[0].status, error: r.rows[0].error });
});

lessonsRouter.get("/:id", async (req, res) => {
  const detail = await getLessonDetail(req.params.id);
  if (!detail) { res.status(404).json({ error: "not found" }); return; }
  res.json(detail);
});

lessonsRouter.patch("/:id/state", async (req, res) => {
  const parsed = LessonStateUpdate.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", code: "BAD_BODY", issues: parsed.error.issues });
    return;
  }
  await updateLessonState(req.params.id, parsed.data);
  res.status(204).end();
});

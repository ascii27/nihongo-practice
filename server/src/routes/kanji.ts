import { Router } from "express";
import { browseKanji, getKanjiDetail } from "../services/kanji.js";

export const kanjiRouter = Router();

// GET /api/kanji?jlpt=N4&grade=2&q=eat — browse/search the reference table.
kanjiRouter.get("/", async (req, res) => {
  const jlpt = typeof req.query.jlpt === "string" ? req.query.jlpt : undefined;
  const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim() : undefined;
  let grade: number | undefined;
  if (typeof req.query.grade === "string" && req.query.grade.trim()) {
    const g = Number(req.query.grade);
    if (Number.isInteger(g)) grade = g;
  }
  const kanji = await browseKanji({ jlpt, grade, q });
  res.json({ kanji });
});

// GET /api/kanji/:character — full detail incl. ordered stroke paths.
kanjiRouter.get("/:character", async (req, res) => {
  const detail = await getKanjiDetail(req.params.character);
  if (!detail) {
    res.status(404).json({ error: "kanji not found", code: "KANJI_NOT_FOUND" });
    return;
  }
  res.json(detail);
});

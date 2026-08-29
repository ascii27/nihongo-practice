import { Router, type Response } from "express";
import { browseKanji, getKanjiDetail } from "../services/kanji.js";
import { getKanjiMnemonic, regenerateKanjiMnemonic, KanjiNotFoundError } from "../services/kanji-mnemonic.js";

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

// GET /api/kanji/:character/mnemonic — cached memory aid, generated on first
// ask. Declared before /:character; that route matches a single segment, so the
// two do not collide, but the specific one stays first by habit.
kanjiRouter.get("/:character/mnemonic", async (req, res) => {
  try {
    res.json(await getKanjiMnemonic(req.params.character));
  } catch (err) {
    sendMnemonicError(res, err);
  }
});

// POST /api/kanji/:character/mnemonic/regenerate — throw this one away and
// write a fresh one. The escape hatch for a mnemonic that lands flat.
kanjiRouter.post("/:character/mnemonic/regenerate", async (req, res) => {
  try {
    res.json(await regenerateKanjiMnemonic(req.params.character));
  } catch (err) {
    sendMnemonicError(res, err);
  }
});

function sendMnemonicError(res: Response, err: unknown): void {
  if (err instanceof KanjiNotFoundError) {
    res.status(404).json({ error: "kanji not found", code: "KANJI_NOT_FOUND" });
    return;
  }
  console.error("kanji mnemonic generation failed", err);
  res.status(502).json({ error: "could not write a mnemonic", code: "MNEMONIC_FAILED" });
}

// GET /api/kanji/:character — full detail incl. ordered stroke paths.
kanjiRouter.get("/:character", async (req, res) => {
  const detail = await getKanjiDetail(req.params.character);
  if (!detail) {
    res.status(404).json({ error: "kanji not found", code: "KANJI_NOT_FOUND" });
    return;
  }
  res.json(detail);
});

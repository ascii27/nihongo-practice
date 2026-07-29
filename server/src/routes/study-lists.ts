import { Router } from "express";
import {
  CreateStudyListRequest, AddStudyItemRequest, QuickAddStudyItemRequest, StudyPreviewRequest,
} from "@nihongo/shared";
import { GenerateError } from "@nihongo/gen";
import {
  listStudyLists, createStudyList, deleteStudyList, getStudyListDetail,
  getCramItems, addItem, removeItem, quickAddItem, searchCandidates, previewQuickItem,
} from "../services/study-lists.js";

export const studyListsRouter = Router();

// POST /api/study-lists/preview — generate editable fields from a raw input
// (no DB write). Vocab/grammar call the AI; kanji reads the reference table.
studyListsRouter.post("/preview", async (req, res) => {
  const parsed = StudyPreviewRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "invalid input", code: "BAD_BODY" });
    return;
  }
  try {
    res.json(await previewQuickItem(parsed.data));
  } catch (err) {
    const message = err instanceof GenerateError ? err.message : err instanceof Error ? err.message : "generation failed";
    res.status(502).json({ error: message, code: "PREVIEW_FAILED" });
  }
});

// GET /api/study-lists — all lists with item counts.
studyListsRouter.get("/", async (_req, res) => {
  const study_lists = await listStudyLists();
  res.json({ study_lists });
});

// POST /api/study-lists — create an empty list.
studyListsRouter.post("/", async (req, res) => {
  const parsed = CreateStudyListRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "invalid input", code: "BAD_BODY" });
    return;
  }
  const { id } = await createStudyList(parsed.data.title.trim(), (parsed.data.description ?? "").trim());
  res.status(201).json({ id });
});

// GET /api/study-lists/:id — header + display rows.
studyListsRouter.get("/:id", async (req, res) => {
  const detail = await getStudyListDetail(req.params.id);
  if (!detail) {
    res.status(404).json({ error: "study list not found", code: "LIST_NOT_FOUND" });
    return;
  }
  res.json(detail);
});

// DELETE /api/study-lists/:id — remove the list (members cascade).
studyListsRouter.delete("/:id", async (req, res) => {
  const ok = await deleteStudyList(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "study list not found", code: "LIST_NOT_FOUND" });
    return;
  }
  res.status(204).end();
});

// GET /api/study-lists/:id/cram — all members as review items, schedule ignored.
studyListsRouter.get("/:id/cram", async (req, res) => {
  const detail = await getStudyListDetail(req.params.id);
  if (!detail) {
    res.status(404).json({ error: "study list not found", code: "LIST_NOT_FOUND" });
    return;
  }
  const items = await getCramItems(req.params.id);
  res.json({ items });
});

// GET /api/study-lists/:id/candidates?q=&skill= — search items to add.
studyListsRouter.get("/:id/candidates", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    res.json({ items: [] });
    return;
  }
  const skill = typeof req.query.skill === "string" && req.query.skill ? req.query.skill : undefined;
  const items = await searchCandidates(req.params.id, q, skill);
  res.json({ items });
});

// POST /api/study-lists/:id/items — add an existing item.
studyListsRouter.post("/:id/items", async (req, res) => {
  const parsed = AddStudyItemRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "invalid input", code: "BAD_BODY" });
    return;
  }
  const result = await addItem(req.params.id, parsed.data.item_id);
  if (result === "no_list") {
    res.status(404).json({ error: "study list not found", code: "LIST_NOT_FOUND" });
    return;
  }
  if (result === "no_item") {
    res.status(404).json({ error: "item not found", code: "ITEM_NOT_FOUND" });
    return;
  }
  res.status(result === "added" ? 201 : 200).json({ status: result });
});

// POST /api/study-lists/:id/quick-add — create a new item and add it.
studyListsRouter.post("/:id/quick-add", async (req, res) => {
  const parsed = QuickAddStudyItemRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "invalid input", code: "BAD_BODY" });
    return;
  }
  const result = await quickAddItem(req.params.id, parsed.data);
  if (!result) {
    res.status(404).json({ error: "study list not found", code: "LIST_NOT_FOUND" });
    return;
  }
  res.status(201).json(result);
});

// DELETE /api/study-lists/:id/items/:itemId — remove a member.
studyListsRouter.delete("/:id/items/:itemId", async (req, res) => {
  const ok = await removeItem(req.params.id, req.params.itemId);
  if (!ok) {
    res.status(404).json({ error: "member not found", code: "MEMBER_NOT_FOUND" });
    return;
  }
  res.status(204).end();
});

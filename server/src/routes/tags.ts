import { Router } from "express";
import {
  CreateTagRequest, UpdateTagRequest, QuickAddItemRequest, QuickAddPreviewRequest,
} from "@nihongo/shared";
import { GenerateError } from "@nihongo/gen";
import {
  listTags, createTag, updateTag, deleteTag, tagItem, untagItem,
  quickAddItem, searchCandidates, previewQuickItem, TagExistsError,
} from "../services/tags.js";

export const tagsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const badBody = (msg?: string) => ({ error: msg ?? "invalid input", code: "BAD_BODY" });
const tagNotFound = { error: "tag not found", code: "TAG_NOT_FOUND" };
const itemNotFound = { error: "item not found", code: "ITEM_NOT_FOUND" };
const tagExists = { error: "a tag with that name already exists", code: "TAG_EXISTS" };

// Non-uuid ids are a plain 404 instead of a Postgres cast error.
tagsRouter.param("id", (_req, res, next, id: string) => {
  if (!UUID_RE.test(id)) {
    res.status(404).json(tagNotFound);
    return;
  }
  next();
});

// POST /api/tags/preview — draft editable fields from a raw input (no DB
// write). Vocab/grammar call the AI; kanji reads the reference table.
tagsRouter.post("/preview", async (req, res) => {
  const parsed = QuickAddPreviewRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(badBody(parsed.error.errors[0]?.message));
    return;
  }
  try {
    res.json(await previewQuickItem(parsed.data));
  } catch (err) {
    const message = err instanceof GenerateError ? err.message : err instanceof Error ? err.message : "generation failed";
    res.status(502).json({ error: message, code: "PREVIEW_FAILED" });
  }
});

// GET /api/tags — every tag with its card count and average mastery.
tagsRouter.get("/", async (_req, res) => {
  res.json({ tags: await listTags() });
});

// POST /api/tags — create an empty tag.
tagsRouter.post("/", async (req, res) => {
  const parsed = CreateTagRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(badBody(parsed.error.errors[0]?.message));
    return;
  }
  try {
    const { id } = await createTag(parsed.data.name, (parsed.data.description ?? "").trim());
    res.status(201).json({ id });
  } catch (err) {
    if (err instanceof TagExistsError) {
      res.status(409).json(tagExists);
      return;
    }
    throw err;
  }
});

// PATCH /api/tags/:id — rename and/or edit the description.
tagsRouter.patch("/:id", async (req, res) => {
  const parsed = UpdateTagRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(badBody(parsed.error.errors[0]?.message));
    return;
  }
  try {
    if (!(await updateTag(req.params.id, parsed.data))) {
      res.status(404).json(tagNotFound);
      return;
    }
    res.status(204).end();
  } catch (err) {
    if (err instanceof TagExistsError) {
      res.status(409).json(tagExists);
      return;
    }
    throw err;
  }
});

// DELETE /api/tags/:id — removes the label; cards and their progress stay.
tagsRouter.delete("/:id", async (req, res) => {
  if (!(await deleteTag(req.params.id))) {
    res.status(404).json(tagNotFound);
    return;
  }
  res.status(204).end();
});

// PUT /api/tags/:id/items/:itemId — tag a card (idempotent).
tagsRouter.put("/:id/items/:itemId", async (req, res) => {
  if (!UUID_RE.test(req.params.itemId)) {
    res.status(404).json(itemNotFound);
    return;
  }
  const r = await tagItem(req.params.id, req.params.itemId);
  if (r === "no_tag") {
    res.status(404).json(tagNotFound);
    return;
  }
  if (r === "no_item") {
    res.status(404).json(itemNotFound);
    return;
  }
  res.status(204).end();
});

// DELETE /api/tags/:id/items/:itemId — untag a card (idempotent).
tagsRouter.delete("/:id/items/:itemId", async (req, res) => {
  if (UUID_RE.test(req.params.itemId)) await untagItem(req.params.id, req.params.itemId);
  res.status(204).end();
});

// POST /api/tags/:id/quick-add — create a new card from the edited preview and tag it.
tagsRouter.post("/:id/quick-add", async (req, res) => {
  const parsed = QuickAddItemRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(badBody(parsed.error.errors[0]?.message));
    return;
  }
  const r = await quickAddItem(req.params.id, parsed.data);
  if (!r) {
    res.status(404).json(tagNotFound);
    return;
  }
  res.status(201).json(r);
});

// GET /api/tags/:id/candidates?q=&skill= — search cards not yet carrying the tag.
tagsRouter.get("/:id/candidates", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    res.json({ items: [] });
    return;
  }
  const skill = typeof req.query.skill === "string" ? req.query.skill : undefined;
  res.json({ items: await searchCandidates(req.params.id, q, skill) });
});

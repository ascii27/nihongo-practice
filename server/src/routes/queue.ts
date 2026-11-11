import { Router } from "express";
import { buildQueue, buildDrill } from "../services/queue.js";
import { DEFAULT_QUEUE_LIMIT } from "../services/session-plan.js";
import { parseFocus, hasFocus } from "../services/focus.js";
import { resolveTz } from "../services/tz.js";

export const queueRouter = Router();

// GET /api/queue?skill=&tag=&tz=&limit= — the day's budgeted session, narrowed
// by an optional focus. `mode=drill` deals every card in the focus instead.
queueRouter.get("/", async (req, res) => {
  const parsed = await parseFocus(req.query);
  if (!parsed.ok) {
    res.status(parsed.status).json(parsed.body);
    return;
  }
  const { focus } = parsed;

  // Drill needs a focus: drilling the entire deck is not a session anyone
  // means to start.
  if (req.query.mode === "drill") {
    if (!hasFocus(focus)) {
      res.status(400).json({ error: "drill needs a skill or tag", code: "FOCUS_REQUIRED" });
      return;
    }
    res.json({ items: await buildDrill(focus) });
    return;
  }

  const limit = Math.min(Math.max(Number(req.query.limit ?? DEFAULT_QUEUE_LIMIT), 1), 500);
  const tz = resolveTz(req.query.tz);
  res.json(await buildQueue({ limit, focus, tz }));
});

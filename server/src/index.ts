import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { env } from "./env.js";
import { passcodeMiddleware } from "./middleware/passcode.js";
import { authRouter } from "./routes/auth.js";
import { queueRouter } from "./routes/queue.js";
import { sessionsRouter } from "./routes/sessions.js";
import { reviewsRouter } from "./routes/reviews.js";
import { statsRouter } from "./routes/stats.js";
import { generateRouter } from "./routes/generate.js";
import { generationsRouter } from "./routes/generations.js";
import { settingsRouter } from "./routes/settings.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { libraryRouter } from "./routes/library.js";
import { itemsRouter } from "./routes/items.js";
import { explainRouter } from "./routes/explain.js";
import { lessonsRouter } from "./routes/lessons.js";
import { grammarPointsRouter } from "./routes/grammar-points.js";
import { kanjiRouter } from "./routes/kanji.js";
import { studyListsRouter } from "./routes/study-lists.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");

export function createApp() {
  const app = express();
  app.use(express.json());
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.use("/audio", express.static(env.AUDIO_DIR));
  app.use("/api", passcodeMiddleware(env.PASSCODE));
  app.use("/api/auth", authRouter);
  app.use("/api/queue", queueRouter);
  app.use("/api/sessions", sessionsRouter);
  app.use("/api/reviews", reviewsRouter);
  app.use("/api/stats", statsRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/library", libraryRouter);
  app.use("/api/items", itemsRouter);
  app.use("/api/explain", explainRouter);
  app.use("/api/generate", generateRouter);
  app.use("/api/generations", generationsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/lessons", lessonsRouter);
  app.use("/api/grammar-points", grammarPointsRouter);
  app.use("/api/kanji", kanjiRouter);
  app.use("/api/study-lists", studyListsRouter);

  if (env.NODE_ENV === "production") {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`server listening on http://localhost:${env.PORT}`);
  });
}

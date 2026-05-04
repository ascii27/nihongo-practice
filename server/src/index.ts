import express from "express";
import { env } from "./env.js";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`server listening on http://localhost:${env.PORT}`);
  });
}

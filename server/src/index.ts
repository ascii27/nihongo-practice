import express from "express";
import { env } from "./env.js";
import { passcodeMiddleware } from "./middleware/passcode.js";
import { authRouter } from "./routes/auth.js";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.use("/api", passcodeMiddleware(env.PASSCODE));
  app.use("/api/auth", authRouter);
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`server listening on http://localhost:${env.PORT}`);
  });
}

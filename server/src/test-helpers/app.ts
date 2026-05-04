import express from "express";
import type { Express } from "express";
import { passcodeMiddleware } from "../middleware/passcode.js";
import { authRouter } from "../routes/auth.js";

// Creates a test app with the same shape as production but a caller-supplied
// passcode and (later) caller-supplied routers. Each new router lands in
// its own task and gets wired here.
export function makeTestApp(passcode: string, mounts?: (app: Express) => void): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", passcodeMiddleware(passcode));
  app.use("/api/auth", authRouter);
  if (mounts) mounts(app);
  return app;
}

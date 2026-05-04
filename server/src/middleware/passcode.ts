import type { Request, Response, NextFunction, RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";

export function passcodeMiddleware(expected: string): RequestHandler {
  const expectedBuf = Buffer.from(expected, "utf8");
  return (req: Request, res: Response, next: NextFunction) => {
    const provided = req.headers["x-passcode"];
    if (typeof provided !== "string") {
      res.status(401).json({ error: "missing passcode", code: "AUTH_MISSING" });
      return;
    }
    const providedBuf = Buffer.from(provided, "utf8");
    if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
      res.status(401).json({ error: "wrong passcode", code: "AUTH_WRONG" });
      return;
    }
    next();
  };
}

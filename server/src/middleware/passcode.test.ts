import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { passcodeMiddleware } from "./passcode.js";

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}
function mockRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe("passcodeMiddleware", () => {
  const correct = "secret123";

  it("calls next when X-Passcode matches", () => {
    const mw = passcodeMiddleware(correct);
    const next: NextFunction = vi.fn();
    mw(mockReq({ "x-passcode": correct }), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 401 when X-Passcode is missing", () => {
    const mw = passcodeMiddleware(correct);
    const res = mockRes();
    const next: NextFunction = vi.fn();
    mw(mockReq({}), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when X-Passcode is wrong", () => {
    const mw = passcodeMiddleware(correct);
    const res = mockRes();
    const next: NextFunction = vi.fn();
    mw(mockReq({ "x-passcode": "nope" }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when wrong passcode is the same length", () => {
    const mw = passcodeMiddleware(correct);
    const res = mockRes();
    const next: NextFunction = vi.fn();
    mw(mockReq({ "x-passcode": "decoy_99" }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

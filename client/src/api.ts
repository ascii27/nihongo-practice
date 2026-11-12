import { auth } from "./auth";

const BASE = import.meta.env.VITE_API_BASE ?? "";

export class AuthError extends Error {}
// Error bodies are `{ error, code }` JSON; the message is the human `error`
// text (falling back to the raw body) and `code` lets callers branch on
// specific failures such as TAG_NOT_FOUND.
export class ApiError extends Error {
  code: string | null;
  constructor(public status: number, body: string) {
    let message = body;
    let code: string | null = null;
    try {
      const parsed = JSON.parse(body) as { error?: unknown; code?: unknown };
      if (typeof parsed.error === "string") message = parsed.error;
      if (typeof parsed.code === "string") code = parsed.code;
    } catch { /* not JSON — keep the raw text */ }
    super(message);
    this.code = code;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const passcode = auth.get();
  const headers = new Headers(init.headers);
  if (passcode) headers.set("X-Passcode", passcode);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    auth.clear();
    throw new AuthError("unauthorized");
  }
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

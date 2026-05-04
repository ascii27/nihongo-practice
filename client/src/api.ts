import { auth } from "./auth";

const BASE = import.meta.env.VITE_API_BASE ?? "";

export class AuthError extends Error {}
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
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

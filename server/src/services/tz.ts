// Falls back to UTC on a missing or invalid zone rather than erroring. Routes
// that require an explicit tz (see routes/stats.ts) validate separately and
// return 400 — this helper is for endpoints where UTC is an acceptable default.
export function resolveTz(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "UTC";
  try {
    // Throws RangeError on an invalid IANA zone name.
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return "UTC";
  }
}

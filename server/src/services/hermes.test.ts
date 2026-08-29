import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { Skill } from "@nihongo/shared";
import { postEvent, emitReviewLogged, hermesConfigured } from "./hermes.js";

const OK = { ok: true, status: 201, text: async () => "" } as Response;

describe("hermes poster", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a no-op when unconfigured (no fetch)", async () => {
    vi.stubEnv("HERMES_BASE_URL", "");
    vi.stubEnv("HERMES_WRITE_KEY", "");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(OK);
    expect(hermesConfigured()).toBe(false);
    await postEvent("review_logged", "2026-07-12T00:00:00Z", { a: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is a no-op when only the base URL is set", async () => {
    vi.stubEnv("HERMES_BASE_URL", "https://hermes.example");
    vi.stubEnv("HERMES_WRITE_KEY", "");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(OK);
    await postEvent("milestone", "2026-07-12T00:00:00Z", {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the envelope with bearer auth to /api/item/nihongo_event", async () => {
    vi.stubEnv("HERMES_BASE_URL", "https://hermes.example/");
    vi.stubEnv("HERMES_WRITE_KEY", "wk_123");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(OK);

    await emitReviewLogged({
      item_id: "11111111-1111-1111-1111-111111111111", skill: "vocab",
      result: "got_it", reviewed_at: "2026-07-12T09:15:00.000Z",
      box_before: 0, box_after: 1, total_reviews: 3, total_missed: 1,
      suspended: false, session_id: null, front: "猫", meaning: "cat",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    // trailing slash on base URL is trimmed
    expect(url).toBe("https://hermes.example/api/item/nihongo_event");
    expect(init!.method).toBe("POST");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer wk_123");
    expect((init!.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const sent = JSON.parse(init!.body as string);
    expect(sent.event_type).toBe("review_logged");
    expect(sent.occurred_at).toBe("2026-07-12T09:15:00.000Z");
    expect(sent.data.item_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(sent.data.front).toBe("猫");
  });

  it("swallows fetch errors (never throws into the caller)", async () => {
    vi.stubEnv("HERMES_BASE_URL", "https://hermes.example");
    vi.stubEnv("HERMES_WRITE_KEY", "wk_123");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(postEvent("review_logged", "2026-07-12T00:00:00Z", {})).resolves.toBeUndefined();
  });

  it("logs but does not throw on a non-ok response", async () => {
    vi.stubEnv("HERMES_BASE_URL", "https://hermes.example");
    vi.stubEnv("HERMES_WRITE_KEY", "wk_123");
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 422, text: async () => "bad schema" } as Response);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(postEvent("review_logged", "2026-07-12T00:00:00Z", {})).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});

// The Hermes type's `skill` enum lives in scripts/hermes-type.mjs and is
// validated server-side by hermes-jester. When a new skill was added to the app
// without updating that enum, every review of the new skill was silently
// rejected with a 422 for weeks — postEvent swallows failures by design, so
// nothing surfaced. This guards the two lists against drifting again.
describe("hermes-type.mjs skill enum", () => {
  it("covers every skill the app can send", () => {
    const script = readFileSync(
      new URL("../../../scripts/hermes-type.mjs", import.meta.url),
      "utf8",
    );
    const match = script.match(/skill:\s*\{[^}]*?enum:\s*(\[[^\]]*\])/);
    expect(match, "could not find the skill enum in scripts/hermes-type.mjs").not.toBeNull();
    const declared: string[] = JSON.parse(match![1]!);
    expect([...declared].sort()).toEqual([...Skill.options].sort());
  });
});

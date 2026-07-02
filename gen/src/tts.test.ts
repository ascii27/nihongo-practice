import { describe, it, expect, afterEach } from "vitest";
import { synthesizeSpeech } from "./tts.js";

const OLD = process.env.NIHONGO_FAKE_AI;
afterEach(() => { process.env.NIHONGO_FAKE_AI = OLD; });

describe("synthesizeSpeech", () => {
  it("returns a placeholder buffer with zero cost in fake mode", async () => {
    process.env.NIHONGO_FAKE_AI = "1";
    const r = await synthesizeSpeech([{ text: "こんにちは", speaker: 0 }]);
    expect(r.audio.byteLength).toBeGreaterThan(0);
    expect(r.cost_usd).toBe(0);
  });

  it("calls one request per segment and sums characters (real mode)", async () => {
    process.env.NIHONGO_FAKE_AI = "0";
    process.env.OPENAI_API_KEY = "sk-test";
    const calls: unknown[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(init.body as string));
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Response;
    }) as unknown as typeof fetch;
    const r = await synthesizeSpeech(
      [{ text: "ああ", speaker: 0 }, { text: "いい", speaker: 1 }],
      { fetchImpl: fakeFetch },
    );
    expect(calls.length).toBe(2);
    expect(r.chars).toBe(4);
    expect(r.cost_usd).toBeGreaterThan(0);
    expect(r.audio.byteLength).toBe(6); // two 3-byte chunks concatenated
  });

  it("throws when the API returns a non-ok response", async () => {
    process.env.NIHONGO_FAKE_AI = "0";
    process.env.OPENAI_API_KEY = "sk-test";
    const fakeFetch = (async () => ({ ok: false, status: 500, text: async () => "boom" } as Response)) as unknown as typeof fetch;
    await expect(
      synthesizeSpeech([{ text: "x", speaker: 0 }], { fetchImpl: fakeFetch }),
    ).rejects.toThrow();
  });
});

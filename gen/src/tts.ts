import { TTS_MODEL, computeTtsCost } from "./pricing.js";

export type Segment = { text: string; speaker: 0 | 1 };

// Two distinct OpenAI voices so dialogue speakers are audibly different.
const VOICES = ["alloy", "onyx"] as const;

// Minimal non-empty placeholder returned in fake mode / when unconfigured.
// Not a valid tune — playback is not asserted in tests/e2e.
const PLACEHOLDER = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

export async function synthesizeSpeech(
  segments: Segment[],
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ audio: Uint8Array; chars: number; cost_usd: number }> {
  const chars = segments.reduce((n, s) => n + s.text.length, 0);
  const key = process.env.OPENAI_API_KEY;
  if (process.env.NIHONGO_FAKE_AI === "1" || !key) {
    return { audio: PLACEHOLDER, chars, cost_usd: 0 };
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const chunks: Uint8Array[] = [];
  for (const seg of segments) {
    const res = await doFetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: VOICES[seg.speaker] ?? VOICES[0],
        input: seg.text,
        response_format: "mp3",
      }),
    });
    if (!res.ok) {
      const detail = typeof res.text === "function" ? await res.text() : "";
      throw new Error(`TTS request failed: ${res.status} ${detail}`);
    }
    chunks.push(new Uint8Array(await res.arrayBuffer()));
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const audio = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { audio.set(c, off); off += c.byteLength; }
  return { audio, chars, cost_usd: computeTtsCost(chars) };
}
